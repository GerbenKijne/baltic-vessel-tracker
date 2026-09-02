# Data source register

Required by PRD SS12.1 before any live provider is enabled in production.
Phase 1 ships with the simulator adapter only. This file is the gate for
enabling any real provider.

## AISStream

- **Adapter: built** (`workers/ingest/worker/adapters/aisstream.py`,
  `worker/normalize.py`'s `_extract_aisstream`), against the real schema
  in https://github.com/aisstream/ais-message-models
  (`type-definition.yaml`) — not guessed. Only `PositionReport` and
  `ShipStaticData` are parsed; see `workers/ingest/README.md` for the
  documented caveats (no reliable `observed_at` from AIS's `Timestamp`
  field, `ShipStaticData` doesn't carry a position, MMSI is zero-padded
  from AISStream's integer `UserID`).
- Capture status: **not run yet**. The tool to run it exists —
  `workers/ingest/scripts/aisstream_capture.py` — but the actual
  60-minute measurement across Stockholm, Gothenburg, and Öresund still
  needs to happen against a real API key (PRD SS12.1). Run it and paste
  the printed report below.
- Terms review: **not done**. Confirm storage, display, retention, and
  combination with other feeds is permitted before persisting any live
  AISStream data. https://aisstream.io's terms of service haven't been
  read for this project yet.
- **Do not set `INGEST_ADAPTER=aisstream` in a real deployment's `.env`
  until both of the above are done.**
- Docs: https://aisstream.io/documentation
- Operational limits confirmed from the docs (2026-09-02): 3 subscribed
  connections per account, 3 open connections per IP, 1 subscription
  update/second/connection, subscription must be sent within 3 seconds
  of connecting, no uptime SLA, dropped messages if the consumer falls
  behind, reconnect with exponential backoff + jitter (implemented).

<!-- Paste the aisstream_capture.py report here once run -->

## BarentsWatch

- Capture status: **not run**. Needs normalization fixtures run against
  representative messages; document token lifetime and reconnect behavior.
- Terms review: **not done**.
- Docs: https://developer.barentswatch.no/docs/AIS/live-ais-api/

## AISHub / local receiver / licensed Sweden

Post-V1 per the PRD scope table — no spike scheduled.

## Storage sizing

Not estimated yet — depends on the AISStream capture volume (PRD SS12.1,
"estimate position volume and 90-day storage from the capture before
setting production defaults"). `POSITION_RETENTION_DAYS=90` in
`.env.example` is the PRD's suggested starting default, not a measured one.
