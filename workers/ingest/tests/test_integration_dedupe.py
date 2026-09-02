"""Integration test against a real Redis (CI runs this with a service
container; skipped locally where there's no Redis, per docs/adr/0001).
"""
import os

import pytest
from redis.asyncio import from_url

from worker.dedupe import is_duplicate

REDIS_URL = os.environ.get("TEST_REDIS_URL")

pytestmark = pytest.mark.skipif(not REDIS_URL, reason="TEST_REDIS_URL not set")


@pytest.mark.asyncio
async def test_second_occurrence_of_same_key_is_a_duplicate() -> None:
    redis = from_url(REDIS_URL)
    try:
        key = "test-dedupe-key-unique-12345"
        await redis.delete(f"dedupe:{key}")
        assert await is_duplicate(redis, key) is False
        assert await is_duplicate(redis, key) is True
    finally:
        await redis.delete("dedupe:test-dedupe-key-unique-12345")
        await redis.aclose()
