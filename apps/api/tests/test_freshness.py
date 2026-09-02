from datetime import datetime, timedelta, timezone

from app.routers.vessels import freshness_for


def test_recent_observation_is_live() -> None:
    now = datetime.now(timezone.utc)
    assert freshness_for(now - timedelta(seconds=30), now) == "live"


def test_moderately_old_observation_is_delayed() -> None:
    now = datetime.now(timezone.utc)
    assert freshness_for(now - timedelta(minutes=5), now) == "delayed"


def test_very_old_observation_is_stale() -> None:
    now = datetime.now(timezone.utc)
    assert freshness_for(now - timedelta(minutes=20), now) == "stale"


def test_falls_back_to_received_at_when_observed_at_missing() -> None:
    now = datetime.now(timezone.utc)
    assert freshness_for(None, now) == "live"
