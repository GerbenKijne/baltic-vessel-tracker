# ADR-0002: AISStream adapter design

- Status: Accepted (the bounding boxes described below are the
  2026-09-02 capture spike's, not the current live config — see
  [ADR-0003](0003-post-phase1-notes.md) and `docs/data-source-register.md`
  for how coverage changed after this; the "IMO/callsign/destination/
  dimensions/ETA aren't extracted yet" scope cut below was reversed by
  [ADR-0005](0005-vessel-identity-sheet.md))
- Date: 2026-09-02

## Context

Phase 2 (PRD SS19) adds the first real provider adapter. AISStream was
chosen over BarentsWatch to go first (simpler API-key auth vs. OAuth
client-credentials; broader terrestrial coverage). The adapter was built
against the actual schema in
[aisstream/ais-message-models](https://github.com/aisstream/ais-message-models)
(`type-definition.yaml`) and the live documentation at
https://aisstream.io/documentation, not guessed — see PRD SS20.1 ("Do not
invent provider fields or limits").

Per PRD SS12.1, this adapter is **not enabled by default**: the mandatory
60-minute capture across Stockholm/Gothenburg/Öresund and a terms-of-service
review are still outstanding (`docs/data-source-register.md`).

## Decisions

- **Parser dispatch by source, not by adapter.** `worker/normalize.py`'s
  `parse_and_normalize` now dispatches to a source-specific extractor
  (`_extract_simulator`, `_extract_aisstream`) that returns a common
  `_ExtractedFields` shape; everything after extraction (bounds
  checking, sentinel handling, dedupe key, building the canonical
  object) is shared. Adding a provider means adding one extractor
  function, not re-implementing validation.
- **`ShipStaticData` messages carry no position and are handled as
  identity-only updates.** They only call `upsert_vessel_identity`
  (currently just `name`); `upsert_vessel_latest` and
  `insert_position_observation` are skipped entirely for
  `obs.position is None`, because unconditionally upserting
  `vessel_latest` would null out a vessel's last known position with
  every static/voyage broadcast. IMO/callsign/destination/dimensions/ETA
  from `ShipStaticData` are deliberately not extracted yet — richer
  vessel identity is Phase 3 "vessel sheet" scope (PRD SS19), not
  something the ingestion pipeline itself needs.
- **No invented `observed_at` for AISStream position reports.** AIS's
  `PositionReport.Timestamp` field is only the UTC *second* the report
  was generated (0-59) per the ITU-R M.1371 standard — not a usable full
  timestamp on its own. Rather than guessing (e.g. combining it with
  `received_at`'s minute, which could be wrong by up to a minute right
  at a minute boundary), `observed_at` is left `None` and
  `quality_flags` gets `derived_time`, which is exactly the documented
  fallback in PRD SS9.2 ("fall back to received_at when provider time
  is absent or flagged").
- **Dedupe key needs two shapes.** Position-bearing observations still
  dedupe by `source:mmsi:second-bucket:lon:lat` (unchanged). Identity-only
  observations (no position) use a new `compute_identity_dedupe_key`
  bucketed by *minute* instead, since static/voyage data broadcasts far
  less often than position reports and repeats identical content most of
  the time.
- **MMSI zero-padding.** AISStream's `UserID` is a JSON integer, which
  loses leading zeros a base-station MMSI could have; the extractor
  zero-pads to 9 digits (`str(user_id).zfill(9)`) to match the canonical
  contract's fixed-width string MMSI.
- **Bounding boxes default to the PRD's three required capture regions**
  (`workers/ingest/worker/config.py`'s `DEFAULT_BOUNDING_BOXES`), overridable
  via `AISSTREAM_BOUNDING_BOXES` (JSON). One WebSocket connection
  subscribes to all three boxes at once — comfortably inside AISStream's
  documented "3 connections per account" limit, and the capture script
  reuses the same adapter so a clean capture run also proves the
  production code path.
- **Reconnect matches the docs' explicit guidance**: exponential backoff
  with jitter, capped at 60s, then a fresh complete subscription (AISStream
  states resubscribing *replaces* the configuration rather than merging).

## Consequences

- Enabling this adapter for real still requires: running
  `workers/ingest/scripts/aisstream_capture.py` for the full PRD-mandated
  60 minutes, reading AISStream's terms of service, and recording both in
  `docs/data-source-register.md` — none of that is satisfied by this ADR
  or by the code existing.
- `vessel_latest`/`vessels` split (position+kinematics vs. bare identity)
  now actually matters at the code level, not just the schema level — any
  future adapter must respect the same `obs.position is None` branch in
  `worker/main.py`, not just append another `upsert_vessel_latest` call.
