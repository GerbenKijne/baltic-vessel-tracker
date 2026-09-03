"""Small geometry helpers that don't need a live PostGIS round-trip."""
from __future__ import annotations

import math

_EARTH_RADIUS_M = 6_371_000.0


def circle_polygon_wkt(
    center_lon: float, center_lat: float, radius_m: float, segments: int = 32
) -> str:
    """Geodesic circle approximation (spherical-earth destination-point
    formula) around (center_lon, center_lat) with the given radius in
    meters, as a WKT POLYGON. Good enough for a geofence boundary -- not
    survey-grade, but accurate to well under 1% for radii up to a few
    hundred km, and avoids depending on a live database connection for
    PostGIS's own ST_Buffer just to build one polygon."""
    lat1 = math.radians(center_lat)
    lon1 = math.radians(center_lon)
    angular_distance = radius_m / _EARTH_RADIUS_M

    points: list[tuple[float, float]] = []
    for i in range(segments):
        bearing = math.radians(360.0 * i / segments)
        lat2 = math.asin(
            math.sin(lat1) * math.cos(angular_distance)
            + math.cos(lat1) * math.sin(angular_distance) * math.cos(bearing)
        )
        lon2 = lon1 + math.atan2(
            math.sin(bearing) * math.sin(angular_distance) * math.cos(lat1),
            math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
        )
        points.append((math.degrees(lon2), math.degrees(lat2)))

    points.append(points[0])  # WKT polygons must close the ring
    coords = ", ".join(f"{lon} {lat}" for lon, lat in points)
    return f"POLYGON(({coords}))"
