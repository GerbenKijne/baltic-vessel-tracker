import os
from dataclasses import dataclass

# History: originally three small boxes for the PRD SS12.1 mandatory
# capture spike (Stockholm, Gothenburg, Öresund/Copenhagen); then, on
# 2026-09-03, one wider box (Stockholm, Gotland, Åland, southern Finnish
# coast). Both are historical record now (docs/data-source-register.md),
# not the live config.
#
# Replaced again 2026-09-03 (same day, user's explicit choice) with the
# entire Baltic Sea: south to the German/Polish/Danish coast and the
# straits into the Kattegat, north through the whole Gulf of Bothnia,
# east through the Gulf of Finland to St. Petersburg and the Gulf of
# Riga/Baltic states. [[lat, lon], [lat, lon]] (SW corner, NE corner),
# matching AISStream's documented BoundingBoxes order (confirmed against
# https://github.com/aisstream/example's python sample, since the
# corners' magnitudes only make sense as lat/lon, not lon/lat).
#
# Expect substantially more traffic than any prior box -- the Baltic is
# one of the busiest sea regions in the world (HELCOM puts typical
# simultaneous traffic in the low thousands of vessels). The retention
# sweep (worker/retention.py) keeps position_observations bounded
# regardless, but message/row volume and AISStream bandwidth will be
# much higher than the smaller regional boxes this replaces.
#
# Used as the fallback for an aisstream data source row that doesn't set
# its own bounding_boxes (see worker/sources.py) -- no longer read from
# an env var directly (that was AISSTREAM_BOUNDING_BOXES, now replaced by
# the Admin "Data sources" page).
DEFAULT_BOUNDING_BOXES: list[list[list[float]]] = [
    [[53.5, 9.0], [65.9, 30.5]],  # entire Baltic Sea
]


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    redis_url: str
    instance_id: str
    heartbeat_interval_seconds: int
    # Retention (user policy, 2026-09-03): a vessel nobody's watching only
    # needs a day of history; a watchlisted one keeps a full year, since
    # that's specifically what someone is tracking over time. Without
    # this, position_observations grows unbounded once real AIS traffic
    # is flowing continuously.
    retention_default_hours: int = 24
    retention_watchlisted_days: int = 365
    retention_sweep_interval_seconds: int = 3600


def load_config() -> WorkerConfig:
    return WorkerConfig(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql+asyncpg://baltic:baltic@postgres:5432/baltic"
        ),
        redis_url=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
        instance_id=os.environ.get("HOSTNAME", "worker-ingest-1"),
        heartbeat_interval_seconds=int(os.environ.get("SOURCE_HEARTBEAT_SECONDS", "15")),
        retention_default_hours=int(os.environ.get("RETENTION_DEFAULT_HOURS", "24")),
        retention_watchlisted_days=int(os.environ.get("RETENTION_WATCHLISTED_DAYS", "365")),
        retention_sweep_interval_seconds=int(
            os.environ.get("RETENTION_SWEEP_INTERVAL_SECONDS", "3600")
        ),
    )
