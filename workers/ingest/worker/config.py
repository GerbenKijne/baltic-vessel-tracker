import json
import os
from dataclasses import dataclass, field
from typing import Optional

# Originally three small starting boxes for the PRD SS12.1 mandatory
# capture spike (Stockholm, Gothenburg, Öresund/Copenhagen) -- that spike
# is done (docs/data-source-register.md) and those results stay valid as
# a historical record even though the boxes below have since changed.
# Replaced 2026-09-03 with a single wider box per the user's own choice:
# drop Gothenburg/Öresund, focus on the Stockholm area but expand it to
# also cover Gotland, Åland, and the southern Finnish coast (Turku/
# Helsinki). [[lat, lon], [lat, lon]] (SW corner, NE corner), matching
# AISStream's documented BoundingBoxes order (confirmed against
# https://github.com/aisstream/example's python sample, since the
# corners' magnitudes only make sense as lat/lon, not lon/lat).
DEFAULT_BOUNDING_BOXES: list[list[list[float]]] = [
    [[56.7, 17.3], [60.7, 25.2]],  # Stockholm, Gotland, Åland, southern Finnish coast
]


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    redis_url: str
    adapter: str
    instance_id: str
    heartbeat_interval_seconds: int
    aisstream_api_key: Optional[str] = None
    aisstream_bounding_boxes: list[list[list[float]]] = field(
        default_factory=lambda: DEFAULT_BOUNDING_BOXES
    )
    # Retention (user policy, 2026-09-03): a vessel nobody's watching only
    # needs a day of history; a watchlisted one keeps a full year, since
    # that's specifically what someone is tracking over time. Without
    # this, position_observations grows unbounded once real AIS traffic
    # is flowing continuously.
    retention_default_hours: int = 24
    retention_watchlisted_days: int = 365
    retention_sweep_interval_seconds: int = 3600


def load_config() -> WorkerConfig:
    bounding_boxes_raw = os.environ.get("AISSTREAM_BOUNDING_BOXES")
    bounding_boxes = (
        json.loads(bounding_boxes_raw) if bounding_boxes_raw else DEFAULT_BOUNDING_BOXES
    )

    return WorkerConfig(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql+asyncpg://baltic:baltic@postgres:5432/baltic"
        ),
        redis_url=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
        adapter=os.environ.get("INGEST_ADAPTER", "simulator"),
        instance_id=os.environ.get("HOSTNAME", "worker-ingest-1"),
        heartbeat_interval_seconds=int(os.environ.get("SOURCE_HEARTBEAT_SECONDS", "15")),
        aisstream_api_key=os.environ.get("AISSTREAM_API_KEY") or None,
        aisstream_bounding_boxes=bounding_boxes,
        retention_default_hours=int(os.environ.get("RETENTION_DEFAULT_HOURS", "24")),
        retention_watchlisted_days=int(os.environ.get("RETENTION_WATCHLISTED_DAYS", "365")),
        retention_sweep_interval_seconds=int(
            os.environ.get("RETENTION_SWEEP_INTERVAL_SECONDS", "3600")
        ),
    )
