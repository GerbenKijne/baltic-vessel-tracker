"""Fast duplicate check ahead of the database (PRD SS9.2, SS8.1 step 4).

This is a cheap short-circuit, not the source of truth: the unique
constraint on position_observations.dedupe_key in the database is what
actually guarantees idempotent writes even if two worker instances race.
"""
from __future__ import annotations

from redis.asyncio import Redis

_DEDUPE_TTL_SECONDS = 3600


async def is_duplicate(redis: Redis, dedupe_key: str) -> bool:
    key = f"dedupe:{dedupe_key}"
    was_set = await redis.set(key, "1", nx=True, ex=_DEDUPE_TTL_SECONDS)
    return not was_set
