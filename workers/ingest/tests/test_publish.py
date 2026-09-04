import json

from canonical import Source

from worker.normalize import parse_and_normalize
from worker.publish import publish_vessel_upsert


class _FakeRedis:
    """Captures the payload xadd would have sent, without a real Redis."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def xadd(self, stream, fields, **kwargs) -> None:
        self.messages.append(json.loads(fields["payload"]))


def _raw(**overrides) -> dict:
    base = {
        "mmsi": "265123456",
        "lon": 18.1123,
        "lat": 59.3321,
        "sog": 12.4,
        "cog": 87.2,
        "heading": 86,
        "nav_status": 0,
        "message_type": 1,
        "timestamp": "2026-09-02T12:00:00Z",
    }
    base.update(overrides)
    return base


async def test_upsert_message_carries_name_when_the_observation_has_one() -> None:
    obs = parse_and_normalize(_raw(name="MS EXAMPLE"), Source.SIMULATOR)
    redis = _FakeRedis()

    await publish_vessel_upsert(redis, obs)

    assert redis.messages[0]["name"] == "MS EXAMPLE"


async def test_upsert_message_has_a_null_name_key_for_a_position_only_observation() -> None:
    # A real AIS Class A position report never carries a name -- only the
    # separate, position-less static-data message does, so this is the
    # normal case. The frontend relies on this key being present (even as
    # null) and falls back to the previously known name instead of
    # blanking it -- see useLiveVessels' merge.
    obs = parse_and_normalize(_raw(), Source.SIMULATOR)
    assert obs.name is None
    redis = _FakeRedis()

    await publish_vessel_upsert(redis, obs)

    message = redis.messages[0]
    assert "name" in message
    assert message["name"] is None
