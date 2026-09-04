# ADR-0005: Vessel identity/voyage sheet (ship type, IMO, dimensions, destination, ETA)

- Status: Accepted
- Date: 2026-09-05

## Context

ADR-0002 explicitly deferred extracting IMO, callsign, destination,
dimensions, and ETA from AISStream's static/voyage messages, calling it
"Phase 3 vessel sheet scope" — until now only the vessel name was pulled
out of `ShipStaticData`/`StaticDataReport`, so the frontend's Identity
and Voyage sections always showed "Unknown"/"Not reported" for every
vessel. `vessels.imo`/`callsign`/`ship_type`/`dimensions` had already
been provisioned as unused columns since the very first migration
(0001), so this was a wiring gap, not new schema.

## Decisions

- **Ship type is resolved to a friendly category at ingest time, not
  stored as the raw AIS code.** `_ais_ship_type_category` in
  `worker/normalize.py` collapses the ITU-R M.1371 Table 50 numeric code
  (0-99, including per-category hazard-cargo subcodes like 71-74) down
  to one of ~20 plain-English labels ("Cargo vessel", "Fishing vessel",
  "Sailing vessel", ...). The raw code isn't kept anywhere. This is
  simpler than shipping a code table to the frontend and resolving it
  there, and this app has no use for the hazard-cargo subclassification
  the raw code also carries.
- **ETA is stored as formatted text ("MM-DD" or "MM-DD HH:MM"), never a
  real datetime.** AIS's ETA field has no year, and 0/24/60 are the
  field's own "not available" sentinels for month/hour/minute — inventing
  a year would violate this project's standing rule (PRD SS9.2, also
  behind `observed_at`'s `derived_time` handling) against fabricating
  data a provider didn't actually give us.
- **Dimensions are stored as `{loa_m, beam_m}`, not the raw A/B/C/D
  antenna-offset distances.** AIS reports how far the GPS antenna sits
  from the bow/stern/port/starboard; LOA = A+B and beam = C+D are the
  only derived values any current UI needs, so the raw four numbers
  aren't persisted.
- **Destination/ETA/draught live on `vessel_latest`, not `vessels`** —
  unlike ship type/IMO/callsign/dimensions, they're voyage-specific and
  expected to change every trip, matching where `destination` (already
  in the schema since 0001, just never written by AISStream) already
  lived. `vessel_latest` gained two new columns (`eta_text`,
  `draught_m`) in migration 0006; everything else already existed.
- **`upsert_vessel_identity`/`upsert_vessel_latest` now COALESCE every
  vessel-attribute field against the existing row, instead of
  overwriting flat.** This fixes a latent bug this work would otherwise
  have made immediately visible: `vessel_latest` is written on every
  accepted message, but identity/voyage fields only arrive on sporadic
  static-data messages — a plain overwrite would null a vessel's
  destination (or now, its position/speed/heading too) back out on the
  very next ordinary position report. `_VESSEL_LATEST_COALESCE_FIELDS`
  in `persistence.py` lists exactly which columns get this treatment;
  `received_at`/`observed_at`/`quality_flags`/`provenance` describe the
  triggering message itself and still overwrite flat, since coalescing
  those would misrepresent the message that actually produced this row.
  A consequence: `upsert_vessel_latest` is now called for *every*
  accepted message in `worker/main.py`, not just ones with a position —
  safe specifically because of the COALESCE, since it can now only fill
  in a field, never erase one.
- **The frontend fetches this data via a new `GET /api/v1/vessels/{mmsi}`
  REST endpoint, not the live WebSocket feed.** The live feed's
  `vessel.upsert` messages only carry whatever the triggering message
  itself mentioned (a position report never carries a name, IMO, or
  destination) — extending that protocol to include identity/voyage
  fields would make them flicker to "Unknown" between the sporadic
  static-data messages that actually populate them, since each push
  fully replaces the frontend's cached vessel object. A one-shot REST
  fetch when the drawer opens sidesteps this entirely by reading the
  already-merged, already-COALESCEd database row instead. The
  Watchlists list view gets the same data through its own existing
  per-list query instead (already joins `vessels`), not this endpoint,
  to avoid N+1 fetches for a list of vessels.

## Consequences

- The live map/WebSocket protocol (`VesselUpsertMessage`,
  `publish_vessel_upsert`, `useLiveVessels`) is untouched by this work.
  It still has the same latent "replaces the whole cached vessel object"
  behavior described above for the fields it *does* carry (most
  visibly: a vessel's `name` from the initial snapshot can currently be
  overwritten to `null` by a subsequent position-only `vessel.upsert}`
  for any provider that splits identity from position, i.e. real
  AISStream Class A traffic, not the simulator). That's a pre-existing
  bug this ADR does not fix — flagged separately rather than folded into
  this change's scope.
- A future contributor adding a new field from these same static/voyage
  messages should extend `_ExtractedFields` in `normalize.py` and follow
  the same COALESCE pattern in `persistence.py` — a flat overwrite on
  `vessel_latest` or `vessels` will silently regress on the next message
  that doesn't happen to mention the new field.
