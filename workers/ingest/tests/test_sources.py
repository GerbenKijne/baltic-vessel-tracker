import pytest

from worker.adapters.aisstream import AISStreamAdapter
from worker.adapters.simulator import SimulatorAdapter
from worker.sources import SourceConfig, build_adapter


def test_build_adapter_simulator() -> None:
    source = SourceConfig(
        id="abc123", name="Demo", adapter="simulator", api_key=None, bounding_boxes=None
    )
    assert isinstance(build_adapter(source), SimulatorAdapter)


def test_build_adapter_aisstream() -> None:
    boxes = [[[59.0, 18.0], [60.0, 19.0]]]
    source = SourceConfig(
        id="abc123",
        name="Baltic AISStream",
        adapter="aisstream",
        api_key="key",
        bounding_boxes=boxes,
    )
    adapter = build_adapter(source)
    assert isinstance(adapter, AISStreamAdapter)
    assert adapter._subscription_message()["BoundingBoxes"] == boxes


def test_build_adapter_aisstream_falls_back_to_default_boxes() -> None:
    source = SourceConfig(
        id="abc123",
        name="Baltic AISStream",
        adapter="aisstream",
        api_key="key",
        bounding_boxes=None,
    )
    adapter = build_adapter(source)
    assert isinstance(adapter, AISStreamAdapter)
    assert adapter._subscription_message()["BoundingBoxes"] == [[[53.5, 9.0], [65.9, 30.5]]]


def test_build_adapter_aisstream_requires_api_key() -> None:
    source = SourceConfig(
        id="abc123", name="Baltic AISStream", adapter="aisstream", api_key=None, bounding_boxes=None
    )
    with pytest.raises(ValueError):
        build_adapter(source)


def test_build_adapter_unknown_adapter() -> None:
    source = SourceConfig(
        id="abc123", name="Mystery", adapter="carrier_pigeon", api_key=None, bounding_boxes=None
    )
    with pytest.raises(ValueError):
        build_adapter(source)
