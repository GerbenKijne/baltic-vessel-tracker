"""Delivers queued email/webhook notifications (Alerts feature, extended
2026-09-05 -- see docs/adr/0007-alert-delivery-channels.md). alerts.py's
_fire() queues one notification_deliveries row per configured channel in
the same transaction as the alert_events insert; this module is the
separate periodic loop that actually sends them.

Delivery lives here (in the already-continuous worker-ingest process,
alongside alerts_loop) rather than in a new service, for the same reason
ADR-0003 keeps rule evaluation here: one already-running worker, no new
deployment unit. It's a second loop rather than folded into alerts_loop
itself because delivery is outbound network I/O with its own retry/
backoff needs -- a failed webhook shouldn't block or slow down alert
evaluation.

Written against raw SQL, same choice and same reasoning as alerts.py:
notification_deliveries/alert_events/alert_rules/vessels/smtp_settings
are used here exactly as apps/api's migrations define them, with no
separate Python table mirror to keep in sync for a feature this narrow.

Assumes a single worker-ingest instance (same assumption alerts.py's
stale-rule sweep already makes) -- claiming a batch and immediately
marking it 'sending' is enough to stop the same row being sent twice by
this one loop; it would need FOR UPDATE SKIP LOCKED to be safe if this
worker were ever scaled to multiple replicas.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Optional

import aiosmtplib
import httpx
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)


class _NotConfiguredError(RuntimeError):
    """Raised when a channel structurally cannot succeed (e.g. no SMTP
    host set) -- these fail immediately, no point retrying until an
    admin fixes the configuration and a *new* alert fires."""


_BATCH_SIZE = 50
_MAX_ATTEMPTS = 5
_MAX_BACKOFF_SECONDS = 3600
_HTTP_TIMEOUT_SECONDS = 10


async def _claim_due(engine: AsyncEngine) -> list[Row]:
    async with engine.begin() as conn:
        claimed_ids = (
            await conn.execute(
                text(
                    """
                    WITH due AS (
                        SELECT id FROM notification_deliveries
                        WHERE status IN ('pending', 'retrying')
                          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                        ORDER BY id
                        LIMIT :limit
                    )
                    UPDATE notification_deliveries
                    SET status = 'sending'
                    WHERE id IN (SELECT id FROM due)
                    RETURNING id
                    """
                ),
                {"limit": _BATCH_SIZE},
            )
        ).all()
        if not claimed_ids:
            return []
        ids = [row.id for row in claimed_ids]
        return (
            await conn.execute(
                text(
                    """
                    SELECT
                        nd.id, nd.channel, nd.attempt,
                        e.id AS event_id, e.rule_id, e.mmsi, e.occurred_at, e.context,
                        r.name AS rule_name, r.type AS rule_type,
                        r.email_to, r.webhook_url, r.webhook_secret,
                        v.name AS vessel_name
                    FROM notification_deliveries nd
                    JOIN alert_events e ON e.id = nd.event_id
                    JOIN alert_rules r ON r.id = e.rule_id
                    LEFT JOIN vessels v ON v.mmsi = e.mmsi
                    WHERE nd.id = ANY(:ids)
                    """
                ),
                {"ids": ids},
            )
        ).all()


def _event_payload(row: Row) -> dict[str, Any]:
    return {
        "event_id": str(row.event_id),
        "rule_id": str(row.rule_id),
        "rule_name": row.rule_name,
        "rule_type": row.rule_type,
        "mmsi": row.mmsi,
        "vessel_name": row.vessel_name,
        "occurred_at": row.occurred_at.isoformat(),
        "context": row.context,
    }


async def _load_smtp_settings(engine: AsyncEngine) -> Optional[Row]:
    async with engine.connect() as conn:
        return (
            await conn.execute(
                text(
                    "SELECT host, port, username, password, from_address, use_tls "
                    "FROM smtp_settings WHERE id = 1"
                )
            )
        ).first()


async def _send_email(smtp: Row, to: str, row: Row) -> None:
    if not smtp.host or not smtp.from_address:
        raise _NotConfiguredError("SMTP host/from address not configured")
    payload = _event_payload(row)
    message = EmailMessage()
    message["From"] = smtp.from_address
    message["To"] = to
    message["Subject"] = f"Baltic Vessel Tracker alert: {row.rule_name}"
    message.set_content(
        f"Rule \"{row.rule_name}\" fired for {row.vessel_name or row.mmsi} "
        f"at {row.occurred_at.isoformat()}.\n\n{json.dumps(payload['context'], indent=2)}"
    )
    await aiosmtplib.send(
        message,
        hostname=smtp.host,
        port=smtp.port,
        username=smtp.username or None,
        password=smtp.password or None,
        start_tls=smtp.use_tls,
    )


async def _send_webhook(url: str, secret: Optional[str], row: Row) -> None:
    body = json.dumps(_event_payload(row)).encode()
    headers = {"Content-Type": "application/json"}
    if secret:
        digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-Signature"] = f"sha256={digest}"
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
        response = await client.post(url, content=body, headers=headers)
        response.raise_for_status()


async def _mark_sent(engine: AsyncEngine, delivery_id: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE notification_deliveries SET status = 'sent' WHERE id = :id"),
            {"id": delivery_id},
        )


async def _mark_failed_permanent(engine: AsyncEngine, delivery_id: str, error: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE notification_deliveries SET status = 'failed', error = :error "
                "WHERE id = :id"
            ),
            {"id": delivery_id, "error": error[:2000]},
        )


async def _mark_failed(engine: AsyncEngine, delivery_id: str, attempt: int, error: str) -> None:
    next_attempt = attempt + 1
    async with engine.begin() as conn:
        if next_attempt >= _MAX_ATTEMPTS:
            await conn.execute(
                text(
                    "UPDATE notification_deliveries "
                    "SET status = 'failed', attempt = :attempt, error = :error "
                    "WHERE id = :id"
                ),
                {"id": delivery_id, "attempt": next_attempt, "error": error[:2000]},
            )
        else:
            backoff = min(2**next_attempt * 30, _MAX_BACKOFF_SECONDS)
            await conn.execute(
                text(
                    "UPDATE notification_deliveries "
                    "SET status = 'retrying', attempt = :attempt, error = :error, "
                    "    next_attempt_at = :next_attempt_at "
                    "WHERE id = :id"
                ),
                {
                    "id": delivery_id,
                    "attempt": next_attempt,
                    "error": error[:2000],
                    "next_attempt_at": datetime.now(timezone.utc) + timedelta(seconds=backoff),
                },
            )


async def deliver_pending_notifications(engine: AsyncEngine) -> None:
    rows = await _claim_due(engine)
    if not rows:
        return

    smtp_settings: Optional[Row] = None
    smtp_loaded = False

    for row in rows:
        delivery_id = str(row.id)
        try:
            if row.channel == "email":
                if not smtp_loaded:
                    smtp_settings = await _load_smtp_settings(engine)
                    smtp_loaded = True
                if smtp_settings is None or not smtp_settings.host:
                    raise _NotConfiguredError("SMTP not configured")
                await _send_email(smtp_settings, row.email_to, row)
            elif row.channel == "webhook":
                await _send_webhook(row.webhook_url, row.webhook_secret, row)
            else:
                raise RuntimeError(f"Unknown channel {row.channel!r}")
        except _NotConfiguredError as exc:
            logger.warning("Delivery %s (%s) permanently failed: %s", delivery_id, row.channel, exc)
            await _mark_failed_permanent(engine, delivery_id, str(exc))
        except Exception as exc:  # noqa: BLE001 - one delivery failure must not stop the batch
            logger.warning("Delivery %s (%s) failed: %s", delivery_id, row.channel, exc)
            await _mark_failed(engine, delivery_id, row.attempt, str(exc))
        else:
            await _mark_sent(engine, delivery_id)


async def notify_loop(engine: AsyncEngine, interval_seconds: int = 15) -> None:
    while True:
        try:
            await deliver_pending_notifications(engine)
        except Exception:  # noqa: BLE001 - a pass failure must not crash the worker
            logger.exception("Notification delivery pass failed; will retry next interval")
        await asyncio.sleep(interval_seconds)
