"""Alert rule evaluation (Alerts feature, added 2026-09-03): checks each
accepted position update against enabled geofence_enter/geofence_exit and
speed_above rules, plus a periodic sweep for stale rules (there's no
incoming message to hang a stale check off of -- it's the *absence* of
one). "Accepted" matters: this only runs after a message has passed
parsing, dedup, and persistence, matching the design handoff's own
principle that a rejected or duplicate observation never fires a rule.

Written against raw SQL rather than the Core-table-mirror pattern the
rest of this worker uses for vessels/positions/etc: the JSONB target/
params matching and PostGIS containment checks read more clearly as
explicit SQL than reconstructed through SQLAlchemy Core expressions, and
alert_rules/alert_events/geofences are used here exactly as apps/api's
migrations define them, with no separate Python table mirror to keep in
sync for a feature this narrow.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

logger = logging.getLogger(__name__)

_POSITION_RULE_TYPES = ("geofence_enter", "geofence_exit", "speed_above")


async def _matching_rules(
    conn: AsyncConnection, mmsi: str, types: tuple[str, ...]
) -> list[Row]:
    return (
        await conn.execute(
            text(
                """
                SELECT id, type, params, cooldown_seconds
                FROM alert_rules
                WHERE enabled = true
                  AND type = ANY(:types)
                  AND (
                    target->>'kind' = 'all'
                    OR (target->>'kind' = 'vessel' AND target->>'mmsi' = :mmsi)
                    OR (target->>'kind' = 'watchlist' AND EXISTS (
                        SELECT 1 FROM watchlist_vessels wv
                        WHERE wv.watchlist_id = (target->>'watchlist_id')::uuid
                          AND wv.mmsi = :mmsi
                    ))
                  )
                """
            ),
            {"types": list(types), "mmsi": mmsi},
        )
    ).all()


async def _point_covered_by_geofence(
    conn: AsyncConnection, geofence_id: str, lon: float, lat: float
) -> bool:
    row = (
        await conn.execute(
            text(
                "SELECT ST_Covers(geometry, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)"
                " AS covered FROM geofences WHERE id = :id AND enabled = true"
            ),
            {"lon": lon, "lat": lat, "id": geofence_id},
        )
    ).first()
    return bool(row.covered) if row is not None else False


async def _within_cooldown(
    conn: AsyncConnection, rule_id: str, mmsi: str, cooldown_seconds: int
) -> bool:
    row = (
        await conn.execute(
            text(
                "SELECT occurred_at FROM alert_events "
                "WHERE rule_id = :rule_id AND mmsi = :mmsi "
                "ORDER BY occurred_at DESC LIMIT 1"
            ),
            {"rule_id": rule_id, "mmsi": mmsi},
        )
    ).first()
    if row is None:
        return False
    elapsed = (datetime.now(timezone.utc) - row.occurred_at).total_seconds()
    return elapsed < cooldown_seconds


async def _fire(
    conn: AsyncConnection, rule_id: str, mmsi: str, transition_key: str, context: dict[str, Any]
) -> None:
    await conn.execute(
        text(
            """
            INSERT INTO alert_events (id, rule_id, mmsi, transition_key, occurred_at, context)
            VALUES (:id, :rule_id, :mmsi, :transition_key, :occurred_at, CAST(:context AS jsonb))
            ON CONFLICT (transition_key) DO NOTHING
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "rule_id": rule_id,
            "mmsi": mmsi,
            "transition_key": transition_key,
            "occurred_at": datetime.now(timezone.utc),
            "context": json.dumps(context),
        },
    )
    logger.info("Alert fired: rule=%s mmsi=%s %s", rule_id, mmsi, context)


async def evaluate_position_alerts(
    conn: AsyncConnection,
    mmsi: str,
    lon: float,
    lat: float,
    sog_kn: Optional[float],
    received_at: datetime,
    previous_position: Optional[tuple[float, float]],
) -> None:
    rules = await _matching_rules(conn, mmsi, _POSITION_RULE_TYPES)
    for rule in rules:
        rule_id = str(rule.id)

        if rule.type == "speed_above":
            threshold = rule.params.get("threshold_kn")
            if sog_kn is None or threshold is None or sog_kn <= threshold:
                continue
            if await _within_cooldown(conn, rule_id, mmsi, rule.cooldown_seconds):
                continue
            bucket = received_at.replace(microsecond=0).isoformat()
            await _fire(
                conn, rule_id, mmsi, f"{rule_id}:{mmsi}:speed:{bucket}",
                {"sog_kn": sog_kn, "threshold_kn": threshold},
            )
            continue

        geofence_id = rule.params.get("geofence_id")
        if not geofence_id:
            continue
        now_inside = await _point_covered_by_geofence(conn, geofence_id, lon, lat)
        if previous_position is not None:
            prev_lon, prev_lat = previous_position
            was_inside = await _point_covered_by_geofence(conn, geofence_id, prev_lon, prev_lat)
        else:
            was_inside = False
        transitioned = (rule.type == "geofence_enter" and now_inside and not was_inside) or (
            rule.type == "geofence_exit" and was_inside and not now_inside
        )
        if not transitioned:
            continue
        if await _within_cooldown(conn, rule_id, mmsi, rule.cooldown_seconds):
            continue
        bucket = received_at.replace(microsecond=0).isoformat()
        await _fire(
            conn, rule_id, mmsi, f"{rule_id}:{mmsi}:{rule.type}:{bucket}",
            {"lon": lon, "lat": lat, "geofence_id": geofence_id},
        )


async def evaluate_stale_alerts(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        rules = (
            await conn.execute(
                text(
                    "SELECT id, target, params, cooldown_seconds FROM alert_rules "
                    "WHERE enabled = true AND type = 'stale'"
                )
            )
        ).all()

        for rule in rules:
            minutes = rule.params.get("minutes")
            if not minutes:
                continue
            kind = rule.target.get("kind")
            if kind == "all":
                where_sql, params = "TRUE", {}
            elif kind == "vessel":
                where_sql, params = "vl.mmsi = :mmsi", {"mmsi": rule.target.get("mmsi")}
            elif kind == "watchlist":
                where_sql = (
                    "vl.mmsi IN (SELECT mmsi FROM watchlist_vessels "
                    "WHERE watchlist_id = :watchlist_id)"
                )
                params = {"watchlist_id": rule.target.get("watchlist_id")}
            else:
                continue

            stale_rows = (
                await conn.execute(
                    text(
                        f"""
                        SELECT vl.mmsi
                        FROM vessel_latest vl
                        WHERE {where_sql}
                          AND COALESCE(vl.observed_at, vl.received_at)
                              < now() - (:minutes || ' minutes')::interval
                        """
                    ),
                    {**params, "minutes": minutes},
                )
            ).all()

            rule_id = str(rule.id)
            for row in stale_rows:
                if await _within_cooldown(conn, rule_id, row.mmsi, rule.cooldown_seconds):
                    continue
                # A stale vessel has no new message to key a transition off
                # of -- bucket by cooldown window instead, as a stable
                # backstop alongside the cooldown check above (which is
                # what actually governs firing frequency).
                bucket = int(datetime.now(timezone.utc).timestamp() // rule.cooldown_seconds)
                await _fire(
                    conn, rule_id, row.mmsi, f"{rule_id}:{row.mmsi}:stale:{bucket}",
                    {"minutes_threshold": minutes},
                )


async def alerts_loop(engine: AsyncEngine, interval_seconds: int = 60) -> None:
    """Stale rules have no incoming message to key off of, so they need
    their own periodic check -- geofence/speed rules instead evaluate
    inline on each accepted position update (see evaluate_position_alerts,
    called from the main ingest loop)."""
    while True:
        try:
            await evaluate_stale_alerts(engine)
        except Exception:  # noqa: BLE001 - a sweep failure must not crash the worker
            logger.exception("Stale-alert sweep failed; will retry next interval")
        await asyncio.sleep(interval_seconds)
