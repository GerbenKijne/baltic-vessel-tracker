"""AISStream.io adapter (PRD SS12).

Docs: https://aisstream.io/documentation
Message schema: https://github.com/aisstream/ais-message-models

Not enabled by default (PRD SS12.1 gates this behind a measured capture
and a terms review — see docs/data-source-register.md). This adapter
only ever yields the raw provider envelope; parsing into
CanonicalAisObservation happens in worker/normalize.py, per the PRD's
adapter/parser separation (SS8.1).
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import AsyncIterator
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed

from .base import Adapter

logger = logging.getLogger(__name__)

STREAM_URL = "wss://stream.aisstream.io/v0/stream"

# Documented limits (aisstream.io/documentation): 3 subscribed connections
# per account, 3 open connections per originating IP, one subscription
# update per second per connection. A single connection with multiple
# bounding boxes (as used here) stays well inside all three.
_MAX_BACKOFF_SECONDS = 60


class AISStreamAdapter(Adapter):
    source = "aisstream"

    def __init__(
        self,
        api_key: str,
        bounding_boxes: list[list[list[float]]],
        message_types: Optional[list[str]] = None,
        mmsi_filter: Optional[list[str]] = None,
    ):
        if not api_key:
            raise ValueError("AISStream adapter requires an API key")
        self._api_key = api_key
        self._bounding_boxes = bounding_boxes
        self._message_types = message_types or ["PositionReport", "ShipStaticData"]
        self._mmsi_filter = mmsi_filter

    def _subscription_message(self) -> dict:
        message: dict = {
            "APIKey": self._api_key,
            "BoundingBoxes": self._bounding_boxes,
            "FilterMessageTypes": self._message_types,
        }
        if self._mmsi_filter:
            message["FiltersShipMMSI"] = self._mmsi_filter
        return message

    async def stream(self) -> AsyncIterator[dict]:
        backoff = 1.0
        while True:
            try:
                async with websockets.connect(STREAM_URL) as websocket:
                    # Docs require a complete subscription within 3 seconds
                    # of connecting.
                    await websocket.send(json.dumps(self._subscription_message()))
                    backoff = 1.0  # reset on a successful connect+subscribe

                    async for raw in websocket:
                        try:
                            yield json.loads(raw)
                        except json.JSONDecodeError:
                            logger.warning("Dropping non-JSON AISStream message")
            except ConnectionClosed:
                logger.warning("AISStream connection closed, reconnecting")
            except OSError:
                logger.warning("AISStream connection failed, retrying", exc_info=True)

            jitter = random.uniform(0, backoff * 0.25)
            await asyncio.sleep(backoff + jitter)
            backoff = min(backoff * 2, _MAX_BACKOFF_SECONDS)
