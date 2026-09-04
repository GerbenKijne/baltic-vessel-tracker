import copy
import json
from pathlib import Path

import pytest
from canonical import Source

from worker.normalize import IgnorableMessage, parse_and_normalize

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


def test_ship_static_data_extracts_the_full_identity_and_voyage_sheet() -> None:
    obs = parse_and_normalize(_load("ship_static_data.json"), Source.AISSTREAM)
    assert obs.imo == 9339119
    assert obs.callsign == "SEXX"
    assert obs.ship_type == "Cargo vessel"  # Type: 70
    assert obs.dimensions == {"loa_m": 120, "beam_m": 20}  # A+B, C+D
    assert obs.destination == "STOCKHOLM"
    assert obs.eta_text == "09-15 14:30"
    assert obs.draught_m == pytest.approx(6.5)


def test_ship_static_data_treats_zero_imo_and_max_draught_sentinel_as_unavailable() -> None:
    raw = copy.deepcopy(_load("ship_static_data.json"))
    raw["Message"]["ShipStaticData"]["ImoNumber"] = 0
    raw["Message"]["ShipStaticData"]["MaximumStaticDraught"] = 25.5
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.imo is None
    assert obs.draught_m is None


def test_ship_static_data_eta_with_unavailable_month_is_none() -> None:
    raw = copy.deepcopy(_load("ship_static_data.json"))
    raw["Message"]["ShipStaticData"]["Eta"] = {"Month": 0, "Day": 0, "Hour": 24, "Minute": 60}
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.eta_text is None


def test_ship_static_data_eta_with_unavailable_time_keeps_the_date() -> None:
    raw = copy.deepcopy(_load("ship_static_data.json"))
    raw["Message"]["ShipStaticData"]["Eta"] = {"Month": 9, "Day": 15, "Hour": 24, "Minute": 60}
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.eta_text == "09-15"


def test_ship_static_data_all_zero_dimension_is_unavailable() -> None:
    raw = copy.deepcopy(_load("ship_static_data.json"))
    raw["Message"]["ShipStaticData"]["Dimension"] = {"A": 0, "B": 0, "C": 0, "D": 0}
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.dimensions is None


@pytest.mark.parametrize(
    ("type_code", "expected_category"),
    [
        (0, None),  # not available
        (15, None),  # reserved
        (30, "Fishing vessel"),
        (37, "Pleasure craft"),
        (52, "Tug"),
        (69, "Passenger vessel"),
        (80, "Tanker"),
        (99, "Other"),
    ],
)
def test_ship_type_category_lookup(type_code: int, expected_category: str | None) -> None:
    raw = copy.deepcopy(_load("ship_static_data.json"))
    raw["Message"]["ShipStaticData"]["Type"] = type_code
    obs = parse_and_normalize(raw, Source.AISSTREAM)
    assert obs.ship_type == expected_category


def test_subscription_confirmation_is_ignorable_not_an_error() -> None:
    # Confirmed live 2026-09-02: {"MessageType": "SubscriptionConfirmation",
    # "Message": {"CompressionEnabled": true}} -- doesn't nest under
    # Message[MessageType] like real AIS data messages do.
    raw = {"MessageType": "SubscriptionConfirmation", "Message": {"CompressionEnabled": True}}
    with pytest.raises(IgnorableMessage):
        parse_and_normalize(raw, Source.AISSTREAM)


def test_unsupported_message_type_is_rejected() -> None:
    raw = {
        "MessageType": "BaseStationReport",
        "MetaData": {"MMSI": 265547780},
        "Message": {"BaseStationReport": {"UserID": 265547780}},
    }
    with pytest.raises(ValueError):
        parse_and_normalize(raw, Source.AISSTREAM)


def test_parses_standard_class_b_position_report() -> None:
    obs = parse_and_normalize(_load("standard_class_b_position_report.json"), Source.AISSTREAM)
    assert obs.mmsi == "265999888"
    assert obs.position is not None
    assert obs.sog_kn == pytest.approx(5.4)
    assert obs.cog_deg == pytest.approx(210.0)
    assert obs.heading_deg == 208
    assert obs.message_type == 18
    # Class B position reports don't carry navigational status at all.
    assert obs.nav_status is None


def test_parses_extended_class_b_position_report_with_inline_name() -> None:
    obs = parse_and_normalize(_load("extended_class_b_position_report.json"), Source.AISSTREAM)
    assert obs.mmsi == "265999777"
    assert obs.position is not None
    assert obs.message_type == 19
    # Unlike Class A, Extended Class B carries identity inline rather than
    # in a separate static-data message.
    assert obs.name == "SEA BREEZE"


def test_static_data_report_part_a_has_the_name() -> None:
    obs = parse_and_normalize(_load("static_data_report_part_a.json"), Source.AISSTREAM)
    assert obs.mmsi == "265999888"
    assert obs.position is None
    assert obs.name == "WINDFLOWER"
    assert obs.message_type == 24


def test_static_data_report_part_a_does_not_extract_reportb_placeholder_fields() -> None:
    # AISStream's model always includes a ReportB key even on a Part A
    # message, zeroed out as a placeholder -- must not be mistaken for
    # real type/callsign/dimensions data.
    obs = parse_and_normalize(_load("static_data_report_part_a.json"), Source.AISSTREAM)
    assert obs.ship_type is None
    assert obs.callsign is None
    assert obs.dimensions is None


def test_static_data_report_part_b_has_no_name() -> None:
    obs = parse_and_normalize(_load("static_data_report_part_b.json"), Source.AISSTREAM)
    assert obs.mmsi == "265999888"
    assert obs.position is None
    assert obs.name is None
    assert obs.message_type == 24


def test_static_data_report_part_b_extracts_type_callsign_and_dimensions() -> None:
    obs = parse_and_normalize(_load("static_data_report_part_b.json"), Source.AISSTREAM)
    assert obs.ship_type == "Sailing vessel"  # ShipType: 36
    assert obs.callsign == "SM1234"
    assert obs.dimensions == {"loa_m": 10, "beam_m": 4}
    # Class B carries none of these at all.
    assert obs.imo is None
    assert obs.destination is None
    assert obs.eta_text is None
    assert obs.draught_m is None


def test_static_data_report_parts_a_and_b_do_not_collide_in_the_same_minute() -> None:
    # Both parts share an MMSI and can land in the same minute bucket;
    # without a discriminator in the identity dedupe key, one would look
    # like a duplicate of the other and get silently dropped.
    part_a = parse_and_normalize(_load("static_data_report_part_a.json"), Source.AISSTREAM)
    part_b = parse_and_normalize(_load("static_data_report_part_b.json"), Source.AISSTREAM)
    assert part_a.dedupe_key != part_b.dedupe_key
