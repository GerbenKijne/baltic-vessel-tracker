# ADR-0008: Freeform polygon geofences

- Status: Accepted
- Date: 2026-09-05

## Context

Geofences were circles only (center + radius). `schemas.py`'s original
comment block justified this as a V1 scope cut while noting the storage
was already shape-agnostic: `geofences.geometry` is a real PostGIS
`Geography(POLYGON, srid=4326)` column, and the worker's containment
check (`_point_covered_by_geofence`, `ST_Covers`) never assumed
anything circle-specific. That design paid off directly here.

## Decisions

- **No migration.** The `geometry` column already stores any polygon;
  `style` (JSONB) already holds shape-specific authoring data. A
  freeform shape just writes `{"shape": "polygon", "points": [...]}`
  there instead of `{"shape": "circle", "center_lon", ...}` — the
  `"shape"` discriminator was already being written by the original
  circle code, just never read until now.
- **`GeofenceCreate`/`GeofenceOut` become shape-flexible on the same
  schema** (circle fields turn `Optional`, plus an `Optional[polygon]`
  field) rather than a discriminated union or two endpoints. The router
  rejects a request that supplies both or neither. This keeps one
  create/list/delete surface instead of forking geofence CRUD by shape.
- **Fixed a latent bug while touching this code**: `list_geofences` used
  to build `GeofenceOut` via direct `style["center_lon"]` indexing —
  fine while every row was circle-shaped and written by the same code
  that read it, but a `KeyError` (→ 500) waiting to happen the moment a
  differently-shaped row existed. Now branches on `style.get("shape",
  "circle")` with `.get()` throughout.
- **`shapely` validates polygon input server-side** (self-intersection,
  degenerate shapes) before it ever reaches PostGIS — the only new
  dependency this feature needed, since nothing in the repo did
  geometry validation before (the circle math in `geo.py` is hand-rolled
  trig with no invalid-shape case to reject).
- **Polygon authoring is map-only — no manual coordinate entry**, unlike
  circles (which support both map-click and typed lat/lon/radius
  fields). Typing an arbitrary-length list of vertex pairs by hand isn't
  a reasonable form UX; nobody asked for it. `GeofenceMapView` gained a
  Circle/Polygon mode toggle: polygon mode collects vertices on click
  (live line preview under 3 points, closed-polygon preview at 3+), with
  a "Clear points" reset and no per-vertex undo — a reasonable v1 cut,
  since restarting a 3-6 point shape isn't a real burden.
- **No edit/update endpoint for either shape** — consistent with
  existing behavior (circles never had one either); redraw-and-recreate
  is the only path, matching the pre-existing list/create/delete-only
  CRUD.

## Consequences

- A future contributor extending geofence shapes further (e.g.
  multi-polygon, holes) should keep following the `style.shape`
  discriminator pattern rather than adding new top-level columns —
  `geometry` and `style` together already generalize to arbitrary valid
  PostGIS polygons.
- This surfaced a real, fully independent bug fix (`list_geofences`'
  unsafe indexing) as a side effect of adding a second shape — worth
  knowing if a future git-blame or changelog entry looks like it mixes
  concerns; it's one PR because the bug was unreachable until this
  feature made it reachable, not scope creep.
