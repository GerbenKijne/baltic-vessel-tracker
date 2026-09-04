const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;

/** Great-circle distance in nautical miles between two lon/lat points. */
export function haversineNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return (EARTH_RADIUS_KM * c) / 1.852;
}

/** Great-circle distance in meters between two lon/lat points. */
export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** Initial forward bearing in degrees (0-360, 0 = north) from a to b --
 * used to orient a track's "latest position" icon when the source data
 * carries no true heading of its own (position_observations only stores
 * speed, not heading/COG). */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Geodesic circle approximation (spherical-earth destination-point
 * formula) around (centerLon, centerLat) with the given radius in
 * meters, as a closed ring of [lon, lat] pairs -- mirrors
 * apps/api/app/geo.py's circle_polygon_wkt so the client-side preview
 * matches what the server actually stores. */
export function circlePolygonRing(
  centerLon: number,
  centerLat: number,
  radiusM: number,
  segments = 64
): [number, number][] {
  const lat1 = (centerLat * Math.PI) / 180;
  const lon1 = (centerLon * Math.PI) / 180;
  const angularDistance = radiusM / EARTH_RADIUS_M;

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (2 * Math.PI * i) / segments;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );
    points.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return points;
}
