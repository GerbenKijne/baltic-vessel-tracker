import copy
import json
from pathlib import Path

import pytest
from canonical import Source

from worker.normalize import parse_and_normalize

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "packages" / "test-fixtures" / "aisstream"


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text())


def test_parses_a_position_report() -> None:
    obs = parse_and_normalize(_load("position_report.json"), Source.AISSTREAM)
    assert obs.mmsi == "265547780"
    assert obs.position is not None
    assert obs.position.lon == pytest.approx(18.0686)
    assert obs.position.lat == pytest.approx(59.3293)
    assert obs.sog_kn == pytest.approx(12.3)
    assert obs.cog_deg == pytest.approx(87.5)
    assert obs.heading_deg == 88
    assert obs.message_type == 1


def test_position_report_has_no_reliable_observed_at() -> None:
    # AIS's Timestamp field is only a UTC second (0-59); we don't invent
    # a full timestamp from it (see workers/ingest/README.md).
    obs = parse_and_normalize(_load("position_report.json"), Source.AISSTREAM)
    assert obs.observed_at is None
    assert "derived_time" in [f.value for f in obs.quality_flags]


def test_rejects_position_report_flagged_invalid() -> None:
    raw = copy.deepcopy(_load("position_report.json"))
    raw["Message"]["PositionReport"]["Valid"] = False
    with pytest.raises(ValueError):
        parse_and_normalize(raw, Source.AISSTREAM)


def test_speed_sentinel_1023_becomes_none() -> None:
    raw = copy.deepcopy(_load("position_report.json"))
    raw["Message"]["PositionReport"]["Sog"] = 102.3
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.sog_kn is None


def test_course_sentinel_360_becomes_none() -> None:
    raw = copy.deepcopy(_load("position_report.json"))
    raw["Message"]["PositionReport"]["Cog"] = 360.0
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.cog_deg is None


def test_heading_sentinel_511_becomes_none() -> None:
    raw = copy.deepcopy(_load("position_report.json"))
    raw["Message"]["PositionReport"]["TrueHeading"] = 511
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.heading_deg is None


def test_mmsi_is_zero_padded_to_nine_digits() -> None:
    raw = copy.deepcopy(_load("position_report.json"))
    raw["Message"]["PositionReport"]["UserID"] = 12345
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.mmsi == "000012345"


def test_parses_ship_static_data_with_no_position() -> None:
    obs = parse_and_normalize(_load("ship_static_data.json"), Source.AISSTREAM)
    assert obs.mmsi == "265547780"
    assert obs.position is None
    assert obs.name == "EXAMPLE VESSEL"
    assert obs.message_type == 5


def test_unsupported_message_type_is_rejected() -> None:
    raw = {
        "MessageType": "BaseStationReport",
        "MetaData": {"MMSI": 265547780},
        "Message": {"BaseStationReport": {"UserID": 265547780}},
    }
    with pytest.raises(ValueError):
        parse_and_normalize(raw, Source.AISSTREAM)
