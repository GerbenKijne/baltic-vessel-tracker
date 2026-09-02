import json
import os
from dataclasses import dataclass, field
from typing import Optional

# Approximate starting boxes for the PRD SS12.1 mandatory capture spike
# (Stockholm, Gothenburg, Öresund). [[lat, lon], [lat, lon]] per box,
# matching AISStream's documented BoundingBoxes order (confirmed against
# https://github.com/aisstream/example's python sample, since the
# corners' magnitudes only make sense as lat/lon, not lon/lat). Adjust
# after the actual capture if these turn out to miss traffic.
DEFAULT_BOUNDING_BOXES: list[list[list[float]]] = [
    [[59.1, 17.8], [59.5, 18.9]],  # Stockholm
    [[57.5, 11.6], [57.9, 12.1]],  # Gothenburg
    [[55.4, 12.4], [56.0, 13.0]],  # Öresund
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
    )
