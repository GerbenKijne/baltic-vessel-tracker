"""Deterministic-enough fake AIS traffic for local dev and CI (PRD SS20.1:
"use deterministic simulator fixtures for CI"). No network calls, no
credentials. This is the only adapter wired up in Phase 1 — see
docs/adr/0001-architecture-baseline.md.
"""
from __future__ import annotations

import asyncio
import math
import random
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone

from .base import Adapter

# Roughly Stockholm archipelago / Baltic, matching the PRD's default viewport.
_BBOX = {"min_lon": 15.5, "min_lat": 58.5, "max_lon": 20.5, "max_lat": 60.5}

_SHIP_NAMES = [
    "MS ASPO",
    "MV BALTIC STAR",
    "SS GOTLAND TRADER",
    "MV VAXHOLM",
    "MS SANDHAMN",
    "MV ARCHIPELAGO",
    "SS NORRTALJE",
    "MV OSTERSJON",
]


@dataclass
class _SimulatedVessel:
    mmsi: str
    name: str
    lon: float
    lat: float
    cog_deg: float
    sog_kn: float


def _make_fleet(seed: int, size: int) -> list[_SimulatedVessel]:
    rng = random.Random(seed)
    fleet = []
    for i in range(size):
        fleet.append(
            _SimulatedVessel(
                mmsi=f"26512{3000 + i:04d}",
                name=_SHIP_NAMES[i % len(_SHIP_NAMES)],
                lon=rng.uniform(_BBOX["min_lon"], _BBOX["max_lon"]),
                lat=rng.uniform(_BBOX["min_lat"], _BBOX["max_lat"]),
                cog_deg=rng.uniform(0, 360),
                sog_kn=rng.uniform(4, 18),
            )
        )
    return fleet


class SimulatorAdapter(Adapter):
    source = "simulator"

    def __init__(self, fleet_size: int = 12, tick_seconds: float = 2.0, seed: int = 42):
        self._fleet = _make_fleet(seed, fleet_size)
        self._tick_seconds = tick_seconds
        self._rng = random.Random(seed)

    async def stream(self) -> AsyncIterator[dict]:
        while True:
            for vessel in self._fleet:
                vessel.cog_deg = (vessel.cog_deg + self._rng.uniform(-10, 10)) % 360
                distance_deg = (vessel.sog_kn * (self._tick_seconds / 3600)) / 60
                heading_rad = math.radians(vessel.cog_deg)
                vessel.lon += distance_deg * math.sin(heading_rad)
                vessel.lat += distance_deg * math.cos(heading_rad)
                vessel.lon = min(max(vessel.lon, _BBOX["min_lon"]), _BBOX["max_lon"])
                vessel.lat = min(max(vessel.lat, _BBOX["min_lat"]), _BBOX["max_lat"])

                yield {
                    "mmsi": vessel.mmsi,
                    "name": vessel.name,
                    "lon": round(vessel.lon, 5),
                    "lat": round(vessel.lat, 5),
                    "sog": round(vessel.sog_kn, 1),
                    "cog": round(vessel.cog_deg, 1),
                    "heading": int(vessel.cog_deg),
                    "nav_status": 0,
                    "message_type": 1,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            await asyncio.sleep(self._tick_seconds)
