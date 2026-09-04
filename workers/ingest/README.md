# Ingestion worker

Adapter -> parse -> normalize -> dedupe -> persist -> publish (PRD SS8.1).

Which adapter(s) run is no longer an env var (`INGEST_ADAPTER` is gone) --
it's the admin-editable `data_sources` table, managed from the app's
Admin -> Data sources page. `run()` in `worker/main.py` reads every
enabled row at its own startup (`worker/sources.py`) and runs one
`_ingest_loop` per row concurrently, so zero, one, or several adapters
(including two of the same type with different bounding boxes) can run
at once. Adding, editing, enabling, or disabling a row takes effect once
this worker notices the table changed and restarts itself (a background
watcher checks every 20s) -- `restart: unless-stopped` then brings it
back up already reading the new config. A fresh install seeds a single
`simulator` row via migration `0005_data_sources`.

This process also runs two periodic/inline jobs that aren't part of that
pipeline but live here rather than as separate services (see
`docs/adr/0003-post-phase1-notes.md`):

- **Alert rule evaluation** (`worker/alerts.py`): geofence enter/exit and
  speed-above rules evaluate inline on every accepted position update
  (gated on the same "inserted" flag as publishing to the live feed --
  a duplicate or rejected observation never fires a rule). Stale rules
  have no incoming message to key off of, so they run on their own
  60-second sweep instead.
- **Position retention** (`worker/retention.py`): an hourly-by-default
  sweep deletes `position_observations` older than the configured
  window -- a short one for an ordinary vessel, a much longer one for a
  watchlisted vessel. Settings are read fresh from the database every
  sweep (the Admin page's "Retention & storage" section writes to it),
  not from a static env-loaded value, so a change there takes effect on
  the next sweep without restarting this worker.

## `simulator` (default)

No credentials, no network calls. Generates plausible fake AIS traffic
for local dev, demos, and CI. Source: `worker/adapters/simulator.py`.

## `aisstream`

**Not enabled by default on a fresh install** — each deployer needs their
own API key (added from Admin -> Data sources once the app is running)
and should read `docs/data-source-register.md`'s terms-review note
(AISStream has no published Terms of Service for the data itself, only a
privacy policy covering their own site telemetry) and decide for
themselves before enabling it. The PRD SS12.1 capture spike and that
terms review are both done for *this* deployment — see
`docs/data-source-register.md` for the actual results and reasoning.

- Docs: https://aisstream.io/documentation
- Message schema: https://github.com/aisstream/ais-message-models
  (`type-definition.yaml` is the source of truth this adapter's parser
  was built against — re-check it if AISStream changes their schema)
- Requires an API key (free signup at https://aisstream.io), entered per
  data source in Admin -> Data sources -- not an env var.
- Parses Class A (`PositionReport`, `ShipStaticData`) and Class B
  (`StandardClassBPositionReport`, `ExtendedClassBPositionReport`,
  `StaticDataReport`) position/static messages (PRD SS12's "position/
  static messages" scope) — AISStream supports 25 message types total;
  the rest (safety broadcasts, binary messages, base station reports,
  etc.) are out of scope for V1. Class B is what nearly all sailboats,
  pleasure craft, and small fishing boats actually carry, and never
  reports navigational status (that field simply doesn't exist on those
  message types, unlike Class A).
- `ShipStaticData` and `StaticDataReport` carry no position; they update
  the vessel's identity/voyage sheet instead -- name, IMO, callsign, ship
  type (resolved from the AIS numeric code to a category label by
  `_ais_ship_type_category` in `normalize.py`), dimensions (LOA/beam,
  summed from the reported bow/stern/port/starboard distances),
  destination, ETA (formatted as text, not a real date -- AIS's ETA has
  no year), and draught. `StaticDataReport` splits across two messages
  sharing an MMSI (`PartNumber` false = name, true = type/callsign/
  dimensions); Class B never carries IMO/destination/ETA/draught at all
  (those fields don't exist on that message per the AIS standard).
  `upsert_vessel_identity`/`upsert_vessel_latest` COALESCE each field
  against the existing row, so a sparse message (e.g. only a name) never
  clobbers a value already learned from an earlier one. See
  docs/adr/0005-vessel-identity-sheet.md.
- AIS's `PositionReport.Timestamp` field is only the UTC *second* the
  report was generated (0-59), not a usable full timestamp on its own —
  this adapter does not attempt to reconstruct one from it.
  `observed_at` is left `None` and `received_at` is used as the
  effective time, with `quality_flags: [derived_time]` set accordingly
  (PRD SS9.2's documented fallback behavior, not an adapter bug).

### Running the mandatory capture spike (PRD SS12.1)

Before enabling this adapter against real data, run a measured capture
and record the results in `docs/data-source-register.md`:

```bash
export AISSTREAM_API_KEY=...
cd workers/ingest
python -m scripts.aisstream_capture               # 60 minutes, all 3 boxes
python -m scripts.aisstream_capture --minutes 5    # quick smoke test first
python -m scripts.aisstream_capture --box stockholm
```

This uses the real adapter and parser, so a clean run also proves that
code path end-to-end. It prints a JSON summary (unique MMSIs,
messages/minute, update intervals, field completeness, a rough 90-day
storage estimate) meant to be pasted directly into
`docs/data-source-register.md`.
