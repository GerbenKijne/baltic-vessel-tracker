# Ingestion worker

Adapter -> parse -> normalize -> dedupe -> persist -> publish (PRD SS8.1).
Set `INGEST_ADAPTER` to choose which adapter runs; only one runs per
worker process/container.

## `simulator` (default)

No credentials, no network calls. Generates plausible fake AIS traffic
for local dev, demos, and CI. Source: `worker/adapters/simulator.py`.

## `aisstream`

**Not enabled by default in a fresh clone's `.env.example`** — each
deployer needs their own API key and should read
`docs/data-source-register.md`'s terms-review note (AISStream has no
published Terms of Service for the data itself, only a privacy policy
covering their own site telemetry) and decide for themselves before
setting `INGEST_ADAPTER=aisstream`. The PRD SS12.1 capture spike and that
terms review are both done for *this* deployment — see
`docs/data-source-register.md` for the actual results and reasoning.

- Docs: https://aisstream.io/documentation
- Message schema: https://github.com/aisstream/ais-message-models
  (`type-definition.yaml` is the source of truth this adapter's parser
  was built against — re-check it if AISStream changes their schema)
- Requires `AISSTREAM_API_KEY` (free signup at https://aisstream.io).
- Parses Class A (`PositionReport`, `ShipStaticData`) and Class B
  (`StandardClassBPositionReport`, `ExtendedClassBPositionReport`,
  `StaticDataReport`) position/static messages (PRD SS12's "position/
  static messages" scope) — AISStream supports 25 message types total;
  the rest (safety broadcasts, binary messages, base station reports,
  etc.) are out of scope for V1. Class B is what nearly all sailboats,
  pleasure craft, and small fishing boats actually carry, and never
  reports navigational status (that field simply doesn't exist on those
  message types, unlike Class A).
- `ShipStaticData` and `StaticDataReport` carry no position; they only
  update the vessel's name via `upsert_vessel_identity`.
  `StaticDataReport` splits across two messages sharing an MMSI (`PartNumber`
  false = name, true = type/callsign/dimensions) — only the name is
  extracted, same scope cut as `ShipStaticData`. IMO/callsign/destination/
  dimensions aren't extracted yet from either message type — that's
  Phase 3 "vessel sheet" scope (PRD SS19), not required for the ingestion
  pipeline itself.
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
