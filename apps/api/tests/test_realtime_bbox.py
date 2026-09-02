from app.realtime.manager import Bbox


def test_bbox_contains_point_inside() -> None:
    bbox = Bbox(min_lon=10, min_lat=55, max_lon=25, max_lat=65)
    assert bbox.contains(18.0, 59.3) is True


def test_bbox_excludes_point_outside() -> None:
    bbox = Bbox(min_lon=10, min_lat=55, max_lon=25, max_lat=65)
    assert bbox.contains(5.0, 59.3) is False


def test_bbox_boundary_is_inclusive() -> None:
    bbox = Bbox(min_lon=10, min_lat=55, max_lon=25, max_lat=65)
    assert bbox.contains(10.0, 55.0) is True
