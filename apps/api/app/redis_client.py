
from typing import Optional

from redis.asyncio import Redis, from_url

from .config import get_settings

settings = get_settings()

_redis: Optional[Redis] = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = from_url(settings.redis_url, decode_responses=False)
    return _redis
