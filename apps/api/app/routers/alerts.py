import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from geoalchemy2.elements import WKTElement
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_csrf
from ..geo import circle_polygon_wkt
from ..models import AlertEvent, AlertRule, Geofence, User, Vessel, Watchlist
from ..schemas import (
    ALERT_RULE_TYPES,
    ALERT_TARGET_KINDS,
    AlertEventOut,
    AlertRuleCreate,
    AlertRuleOut,
    AlertRuleUpdate,
    GeofenceCreate,
    GeofenceOut,
)

router = APIRouter(prefix="/api/v1", tags=["alerts"])


def _parse_id(raw_id: str, not_found_message: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, not_found_message) from None


async def _get_owned_geofence(db: AsyncSession, geofence_id: str, user: User) -> Geofence:
    row = await db.get(Geofence, _parse_id(geofence_id, "Geofence not found"))
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Geofence not found")
    return row


async def _get_owned_rule(db: AsyncSession, rule_id: str, user: User) -> AlertRule:
    row = await db.get(AlertRule, _parse_id(rule_id, "Alert rule not found"))
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert rule not found")
    return row


async def _validate_target(db: AsyncSession, target: dict, user: User) -> None:
    kind = target.get("kind")
    if kind not in ALERT_TARGET_KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"target.kind must be one of {sorted(ALERT_TARGET_KINDS)}"
        )
    if kind == "vessel":
        mmsi = target.get("mmsi")
        if not mmsi or not await db.get(Vessel, mmsi):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "target.mmsi is not a known vessel")
    elif kind == "watchlist":
        watchlist_id = _parse_id(target.get("watchlist_id", ""), "target.watchlist_id is invalid")
        watchlist = await db.get(Watchlist, watchlist_id)
        if watchlist is None or watchlist.user_id != user.id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "target.watchlist_id is not a known watchlist"
            )


async def _validate_add_to_watchlist(
    db: AsyncSession, add_to_watchlist_id: Optional[str], user: User
) -> None:
    if not add_to_watchlist_id:
        return
    parsed_id = _parse_id(add_to_watchlist_id, "add_to_watchlist_id is invalid")
    watchlist = await db.get(Watchlist, parsed_id)
    if watchlist is None or watchlist.user_id != user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "add_to_watchlist_id is not a known watchlist"
        )


def _validate_threshold_kn(params: dict) -> None:
    if not isinstance(params.get("threshold_kn"), (int, float)) or params["threshold_kn"] <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "params.threshold_kn must be a positive number"
        )


async def _validate_params(db: AsyncSession, rule_type: str, params: dict, user: User) -> None:
    """`geofence_id` and `threshold_kn` are checked independently of which
    one is this rule's primary trigger -- a geofence_enter/exit rule can
    stack an optional `threshold_kn` speed gate onto its transition (only
    fire if also moving above this speed), and a speed_above rule can
    stack an optional `geofence_id` containment gate onto its threshold
    (only fire if also currently inside this geofence). This is how
    "ships over 20kn inside this zone" gets expressed without a separate
    rule type or a general condition-combinator -- see
    docs/adr/0006-stacked-alert-conditions.md."""
    if rule_type in ("geofence_enter", "geofence_exit"):
        await _get_owned_geofence(db, str(params.get("geofence_id", "")), user)
        if "threshold_kn" in params:
            _validate_threshold_kn(params)
    elif rule_type == "stale":
        if not isinstance(params.get("minutes"), (int, float)) or params["minutes"] <= 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "params.minutes must be a positive number"
            )
    elif rule_type == "speed_above":
        _validate_threshold_kn(params)
        if params.get("geofence_id"):
            await _get_owned_geofence(db, str(params["geofence_id"]), user)


# ---------- geofences ----------


@router.get(
    "/geofences", response_model=list[GeofenceOut], dependencies=[Depends(get_current_user)]
)
async def list_geofences(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[GeofenceOut]:
    rows = (await db.execute(select(Geofence).where(Geofence.user_id == user.id))).scalars().all()
    return [
        GeofenceOut(
            id=str(g.id),
            name=g.name,
            center_lon=g.style["center_lon"],
            center_lat=g.style["center_lat"],
            radius_m=g.style["radius_m"],
            enabled=g.enabled,
        )
        for g in rows
    ]


@router.post(
    "/geofences",
    response_model=GeofenceOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf)],
)
async def create_geofence(
    body: GeofenceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> GeofenceOut:
    wkt = circle_polygon_wkt(body.center_lon, body.center_lat, body.radius_m)
    geofence = Geofence(
        id=uuid.uuid4(),
        user_id=user.id,
        name=body.name,
        geometry=WKTElement(wkt, srid=4326),
        style={
            "shape": "circle",
            "center_lon": body.center_lon,
            "center_lat": body.center_lat,
            "radius_m": body.radius_m,
        },
        enabled=True,
    )
    db.add(geofence)
    await db.commit()
    return GeofenceOut(
        id=str(geofence.id),
        name=geofence.name,
        center_lon=body.center_lon,
        center_lat=body.center_lat,
        radius_m=body.radius_m,
        enabled=True,
    )


@router.delete(
    "/geofences/{geofence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_csrf)],
)
async def delete_geofence(
    geofence_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> None:
    geofence = await _get_owned_geofence(db, geofence_id, user)
    in_use = await db.scalar(
        select(func.count()).select_from(AlertRule).where(
            AlertRule.user_id == user.id,
            AlertRule.params["geofence_id"].astext == str(geofence.id),
        )
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{in_use} alert rule(s) still reference this geofence — delete or repoint them first",
        )
    await db.delete(geofence)
    await db.commit()


# ---------- alert rules ----------


@router.get(
    "/alert-rules", response_model=list[AlertRuleOut], dependencies=[Depends(get_current_user)]
)
async def list_alert_rules(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[AlertRuleOut]:
    rows = (
        await db.execute(
            select(AlertRule, func.count(AlertEvent.id))
            .outerjoin(AlertEvent, AlertEvent.rule_id == AlertRule.id)
            .where(AlertRule.user_id == user.id)
            .group_by(AlertRule.id)
            .order_by(AlertRule.name)
        )
    ).all()
    return [
        AlertRuleOut(
            id=str(rule.id),
            name=rule.name,
            type=rule.type,
            target=rule.target,
            params=rule.params,
            cooldown_seconds=rule.cooldown_seconds,
            enabled=rule.enabled,
            add_to_watchlist_id=str(rule.add_to_watchlist_id) if rule.add_to_watchlist_id else None,
            event_count=count,
        )
        for rule, count in rows
    ]


@router.post(
    "/alert-rules",
    response_model=AlertRuleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf)],
)
async def create_alert_rule(
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertRuleOut:
    if body.type not in ALERT_RULE_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"type must be one of {sorted(ALERT_RULE_TYPES)}"
        )
    await _validate_target(db, body.target, user)
    await _validate_params(db, body.type, body.params, user)
    await _validate_add_to_watchlist(db, body.add_to_watchlist_id, user)

    rule = AlertRule(
        id=uuid.uuid4(),
        user_id=user.id,
        name=body.name,
        type=body.type,
        target=body.target,
        params=body.params,
        cooldown_seconds=body.cooldown_seconds,
        enabled=body.enabled,
        # Already confirmed valid and owned by _validate_add_to_watchlist above.
        add_to_watchlist_id=(
            uuid.UUID(body.add_to_watchlist_id) if body.add_to_watchlist_id else None
        ),
    )
    db.add(rule)
    await db.commit()
    return AlertRuleOut(
        id=str(rule.id),
        name=rule.name,
        type=rule.type,
        target=rule.target,
        params=rule.params,
        cooldown_seconds=rule.cooldown_seconds,
        enabled=rule.enabled,
        add_to_watchlist_id=body.add_to_watchlist_id,
        event_count=0,
    )


@router.patch(
    "/alert-rules/{rule_id}",
    response_model=AlertRuleOut,
    dependencies=[Depends(require_csrf)],
)
async def update_alert_rule(
    rule_id: str,
    body: AlertRuleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertRuleOut:
    rule = await _get_owned_rule(db, rule_id, user)

    new_type = body.type if body.type is not None else rule.type
    new_target = body.target if body.target is not None else rule.target
    new_params = body.params if body.params is not None else rule.params
    if body.type is not None and body.type not in ALERT_RULE_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"type must be one of {sorted(ALERT_RULE_TYPES)}"
        )
    if body.target is not None:
        await _validate_target(db, new_target, user)
    if body.type is not None or body.params is not None:
        await _validate_params(db, new_type, new_params, user)
    await _validate_add_to_watchlist(db, body.add_to_watchlist_id, user)

    if body.name is not None:
        rule.name = body.name
    rule.type = new_type
    rule.target = new_target
    rule.params = new_params
    # Always overwritten (like target/params above), not gated on
    # "is not None" -- the frontend always sends this alongside them, and
    # unlike cooldown_seconds/enabled, None here is a real, meaningful
    # value ("no auto-add action"), not "leave unchanged".
    rule.add_to_watchlist_id = (
        uuid.UUID(body.add_to_watchlist_id) if body.add_to_watchlist_id else None
    )
    if body.cooldown_seconds is not None:
        rule.cooldown_seconds = body.cooldown_seconds
    if body.enabled is not None:
        rule.enabled = body.enabled
    await db.commit()

    event_count = await db.scalar(
        select(func.count()).select_from(AlertEvent).where(AlertEvent.rule_id == rule.id)
    )
    return AlertRuleOut(
        id=str(rule.id),
        name=rule.name,
        type=rule.type,
        target=rule.target,
        params=rule.params,
        cooldown_seconds=rule.cooldown_seconds,
        enabled=rule.enabled,
        add_to_watchlist_id=str(rule.add_to_watchlist_id) if rule.add_to_watchlist_id else None,
        event_count=event_count or 0,
    )


@router.delete(
    "/alert-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_csrf)],
)
async def delete_alert_rule(
    rule_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> None:
    rule = await _get_owned_rule(db, rule_id, user)
    await db.delete(rule)
    await db.commit()


# ---------- alert events ----------


@router.get(
    "/alert-events", response_model=list[AlertEventOut], dependencies=[Depends(get_current_user)]
)
async def list_alert_events(
    acknowledged: Optional[bool] = Query(default=None),
    limit: int = Query(default=200, le=1000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertEventOut]:
    query = (
        select(AlertEvent, AlertRule.name, AlertRule.type, Vessel.name)
        .join(AlertRule, AlertRule.id == AlertEvent.rule_id)
        .outerjoin(Vessel, Vessel.mmsi == AlertEvent.mmsi)
        .where(AlertRule.user_id == user.id)
        .order_by(AlertEvent.occurred_at.desc())
        .limit(limit)
    )
    if acknowledged is not None:
        if acknowledged:
            query = query.where(AlertEvent.acknowledged_at.is_not(None))
        else:
            query = query.where(AlertEvent.acknowledged_at.is_(None))

    rows = (await db.execute(query)).all()
    return [
        AlertEventOut(
            id=str(event.id),
            rule_id=str(event.rule_id),
            rule_name=rule_name,
            rule_type=rule_type,
            mmsi=event.mmsi,
            vessel_name=vessel_name,
            occurred_at=event.occurred_at,
            context=event.context,
            acknowledged_at=event.acknowledged_at,
        )
        for event, rule_name, rule_type, vessel_name in rows
    ]


@router.post(
    "/alert-events/{event_id}/acknowledge",
    response_model=AlertEventOut,
    dependencies=[Depends(require_csrf)],
)
async def acknowledge_alert_event(
    event_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> AlertEventOut:
    event = await db.get(AlertEvent, _parse_id(event_id, "Alert event not found"))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert event not found")
    rule = await db.get(AlertRule, event.rule_id)
    if rule is None or rule.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert event not found")

    event.acknowledged_at = datetime.now(timezone.utc)
    await db.commit()

    vessel = await db.get(Vessel, event.mmsi)
    return AlertEventOut(
        id=str(event.id),
        rule_id=str(event.rule_id),
        rule_name=rule.name,
        rule_type=rule.type,
        mmsi=event.mmsi,
        vessel_name=vessel.name if vessel else None,
        occurred_at=event.occurred_at,
        context=event.context,
        acknowledged_at=event.acknowledged_at,
    )
