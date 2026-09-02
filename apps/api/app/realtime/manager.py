"""WebSocket fan-out gateway (PRD SS11.1).

A single background task reads new entries off the `vessel-updates` Redis
stream (written by workers/ingest) and pushes matching updates to each
connected browser's viewport subscription. Viewport filtering happens here,
server-side, so the browser only ever receives vessels it asked about.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket
from redis.asyncio import Redis

from ..config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

STREAM_NAME = "vessel-updates"


@dataclass
class Bbox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def contains(self, lon: float, lat: float) -> bool:
        return self.min_lon <= lon <= self.max_lon and self.min_lat <= lat <= self.max_lat


@dataclass
class Subscription:
    websocket: WebSocket
    bbox: Optional[Bbox] = None
    version: int = 0


def server_time() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConnectionManager:
    def __init__(self) -> None:
        self._subscriptions: dict[WebSocket, Subscription] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._subscriptions[websocket] = Subscription(websocket=websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._subscriptions.pop(websocket, None)

    async def set_subscription(self, websocket: WebSocket, bbox: Bbox) -> int:
        async with self._lock:
            sub = self._subscriptions[websocket]
            sub.bbox = bbox
            sub.version += 1
            return sub.version

    async def broadcast_update(self, message: dict) -> None:
        position = message.get("position")
        if position is None:
            return
        lon, lat = position["lon"], position["lat"]

        async with self._lock:
            subscriptions = list(self._subscriptions.values())

        payload = json.dumps(message)
        for sub in subscriptions:
            if sub.bbox is not None and sub.bbox.contains(lon, lat):
                try:
                    await sub.websocket.send_text(payload)
                except Exception:  # noqa: BLE001 - a dead socket must not break the fan-out
                    logger.debug("Dropping unreachable subscriber", exc_info=True)

    async def send_heartbeats(self) -> None:
        async with self._lock:
            subscriptions = list(self._subscriptions.values())

        message = json.dumps(
            {"type": "heartbeat", "schema_version": 1, "server_time": server_time()}
        )
        for sub in subscriptions:
            try:
                await sub.websocket.send_text(message)
            except Exception:  # noqa: BLE001
                logger.debug("Dropping unreachable subscriber", exc_info=True)


manager = ConnectionManager()


async def stream_listener(redis: Redis, stop_event: asyncio.Event) -> None:
    last_id = "$"
    while not stop_event.is_set():
        try:
            response = await redis.xread({STREAM_NAME: last_id}, block=5000, count=100)
        except Exception:  # noqa: BLE001 - keep retrying on transient Redis errors
            logger.exception("vessel-updates stream read failed, retrying")
            await asyncio.sleep(1)
            continue

        if not response:
            continue

        for _stream, entries in response:
            for entry_id, fields in entries:
                last_id = entry_id
                raw = fields.get(b"payload") or fields.get("payload")
                if raw is None:
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Dropping malformed stream entry %s", entry_id)
                    continue
                await manager.broadcast_update(message)


async def heartbeat_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        await asyncio.sleep(settings.ws_heartbeat_seconds)
        await manager.send_heartbeats()
