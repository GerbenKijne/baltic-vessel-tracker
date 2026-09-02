# Data source register

Required by PRD SS12.1 before any live provider is enabled in production.
Nothing here is populated yet — Phase 1 ships with the simulator adapter
only. This file is the gate for Phase 2.

## AISStream

- Capture status: **not run**. Needs a 60-minute capture for Stockholm,
  Gothenburg, and Öresund bounding boxes recording unique MMSIs,
  position-messages/minute, update intervals, disconnects, and field
  completeness (PRD SS12.1).
- Terms review: **not done**. Confirm storage, display, retention, and
  combination with other feeds is permitted before persisting any live
  AISStream data.
- Docs: https://aisstream.io/documentation

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
