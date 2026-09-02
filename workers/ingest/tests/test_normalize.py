from datetime import datetime, timezone

import pytest
from canonical import NavStatus, Source

from worker.normalize import compute_dedupe_key, parse_and_normalize


def _raw(**overrides) -> dict:
    base = {
        "mmsi": "265123456",
        "name": "MS EXAMPLE",
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


def test_parses_a_well_formed_message() -> None:
    obs = parse_and_normalize(_raw(), Source.SIMULATOR)
    assert obs.mmsi == "265123456"
    assert obs.position is not None
    assert obs.position.lon == pytest.approx(18.1123)
    assert obs.nav_status == NavStatus.UNDER_WAY_USING_ENGINE


def test_rejects_mmsi_with_wrong_length() -> None:
    with pytest.raises(ValueError):
        parse_and_normalize(_raw(mmsi="123"), Source.SIMULATOR)


def test_rejects_out_of_bounds_position() -> None:
    with pytest.raises(ValueError):
        parse_and_normalize(_raw(lon=999.0), Source.SIMULATOR)


def test_heading_sentinel_511_becomes_none() -> None:
    obs = parse_and_normalize(_raw(heading=511), Source.SIMULATOR)
    assert obs.heading_deg is None


def test_control_characters_are_stripped_from_name() -> None:
    obs = parse_and_normalize(_raw(name="MS\x00EXAMPLE\x1f"), Source.SIMULATOR)
    assert obs.name == "MSEXAMPLE"


def test_dedupe_key_is_deterministic_for_same_inputs() -> None:
    obs_a = parse_and_normalize(_raw(), Source.SIMULATOR)
    obs_b = parse_and_normalize(_raw(), Source.SIMULATOR)
    assert obs_a.dedupe_key == obs_b.dedupe_key


def test_dedupe_key_changes_with_position() -> None:
    when = datetime.now(timezone.utc)
    key_a = compute_dedupe_key("simulator", "265123456", when, 18.0, 59.0)
    key_b = compute_dedupe_key("simulator", "265123456", when, 19.0, 59.0)
    assert key_a != key_b
