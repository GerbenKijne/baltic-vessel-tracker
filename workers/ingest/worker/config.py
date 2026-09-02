import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    redis_url: str
    adapter: str
    instance_id: str
    heartbeat_interval_seconds: int


def load_config() -> WorkerConfig:
    return WorkerConfig(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql+asyncpg://baltic:baltic@postgres:5432/baltic"
        ),
        redis_url=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
        adapter=os.environ.get("INGEST_ADAPTER", "simulator"),
        instance_id=os.environ.get("HOSTNAME", "worker-ingest-1"),
        heartbeat_interval_seconds=int(os.environ.get("SOURCE_HEARTBEAT_SECONDS", "15")),
    )
