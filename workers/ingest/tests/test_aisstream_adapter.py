import pytest

from worker.adapters.aisstream import AISStreamAdapter


def test_requires_an_api_key() -> None:
    with pytest.raises(ValueError):
        AISStreamAdapter(api_key="", bounding_boxes=[[[59.0, 18.0], [60.0, 19.0]]])


def test_subscription_message_includes_key_and_boxes() -> None:
    boxes = [[[59.0, 18.0], [60.0, 19.0]]]
    adapter = AISStreamAdapter(api_key="test-key", bounding_boxes=boxes)
    message = adapter._subscription_message()
    assert message["APIKey"] == "test-key"
    assert message["BoundingBoxes"] == boxes
    assert "FiltersShipMMSI" not in message


def test_subscription_message_includes_mmsi_filter_when_given() -> None:
    adapter = AISStreamAdapter(
        api_key="test-key",
        bounding_boxes=[[[59.0, 18.0], [60.0, 19.0]]],
        mmsi_filter=["265123456"],
    )
    message = adapter._subscription_message()
    assert message["FiltersShipMMSI"] == ["265123456"]


def test_default_message_types_include_class_b() -> None:
    # Class B (18/19) is what nearly all sailboats, pleasure craft, and
    # small fishing boats actually carry -- omitting them silently drops
    # that whole category, not a hardware/coverage gap.
    adapter = AISStreamAdapter(api_key="test-key", bounding_boxes=[[[59.0, 18.0], [60.0, 19.0]]])
    message = adapter._subscription_message()
    assert message["FilterMessageTypes"] == [
        "PositionReport",
        "StandardClassBPositionReport",
        "ExtendedClassBPositionReport",
        "ShipStaticData",
        "StaticDataReport",
    ]
