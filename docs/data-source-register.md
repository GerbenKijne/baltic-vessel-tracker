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
- Capture status: **done, 2026-09-02**. 60-minute capture across all
  three required boxes, real API key, zero parse errors, zero
  reconnects, zero positions outside their box. Full report below.
- Terms review: **done, 2026-09-02 — no published terms exist**.
  Checked aisstream.io itself, its privacy policy
  (`aisstream.io/privacypolicy` — covers only site telemetry and GitHub
  OAuth signup, not the AIS data), all three GitHub repos (only
  `ais-message-models`' MIT license, which covers the schema/client code,
  not data usage rights), and common `/terms`, `/tos`, `/legal` paths
  (all 404). There is no Terms of Service or Acceptable Use Policy
  governing storage, retention, redistribution, or commercial use of the
  AIS data itself — not "terms that permit it," an absence of any terms.
  **Decision: proceed anyway.** This is a small, non-commercial,
  self-hosted personal project — not redistributing, reselling, or
  operating at a scale where the absence of stated restrictions is a
  meaningful risk. Revisit if the project's scope or audience changes
  (e.g. multi-tenant, public, commercial).
- **`INGEST_ADAPTER=aisstream` is cleared to enable** in this project's
  own deployment, given the decision above — still don't default a
  *shared/example* `.env` to it, since each deployer needs their own key
  and should make their own call on the terms gap.
- Docs: https://aisstream.io/documentation
- Operational limits confirmed from the docs (2026-09-02): 3 subscribed
  connections per account, 3 open connections per IP, 1 subscription
  update/second/connection, subscription must be sent within 3 seconds
  of connecting, no uptime SLA, dropped messages if the consumer falls
  behind, reconnect with exponential backoff + jitter (implemented).

### Capture report (2026-09-02, 60 minutes, all 3 boxes, one connection)

```json
{
  "captured_at": "2026-09-02T16:48:05.769624+00:00",
  "requested_minutes": 60,
  "actual_minutes": 60.01,
  "parse_errors": 0,
  "reconnects": 0,
  "positions_outside_any_box": 0,
  "boxes": [
    {
      "name": "stockholm",
      "unique_mmsi": 132,
      "position_messages": 1918,
      "position_messages_per_minute": 31.96,
      "static_messages": 690,
      "median_update_interval_seconds": 130.0,
      "field_completeness": {
        "sog_kn": 1.0, "cog_deg": 0.733, "heading_deg": 0.765, "nav_status": 1.0, "name": 0.0
      }
    },
    {
      "name": "gothenburg",
      "unique_mmsi": 132,
      "position_messages": 1829,
      "position_messages_per_minute": 30.48,
      "static_messages": 0,
      "median_update_interval_seconds": 156.8,
      "field_completeness": {
        "sog_kn": 1.0, "cog_deg": 0.884, "heading_deg": 0.792, "nav_status": 1.0, "name": 0.0
      }
    },
    {
      "name": "oresund",
      "unique_mmsi": 51,
      "position_messages": 512,
      "position_messages_per_minute": 8.53,
      "static_messages": 0,
      "median_update_interval_seconds": 180.1,
      "field_completeness": {
        "sog_kn": 0.988, "cog_deg": 0.936, "heading_deg": 0.859, "nav_status": 1.0, "name": 0.0
      }
    }
  ],
  "storage_estimate_90_days_mb": 1754.3
}
```

**Reading this:**

- **Coverage is real and usable**: 132 unique vessels in Stockholm and
  Gothenburg each over the hour, 51 in Öresund (a smaller box); position
  updates every ~2-3 minutes per vessel on average (median interval
  130-180s), not the near-real-time cadence a receiver right on top of
  the traffic would give, but consistent with AISStream's terrestrial
  aggregation rather than a dedicated local receiver.
- **`name` field completeness of `0.0` is expected, not a gap**: it's
  measured only on position-report observations, and names only ever
  come from `ShipStaticData` (see the adapter note above) — the 690
  static messages received in the Stockholm box in the same hour prove
  names *are* available, just via a separate message/observation.
- **Gothenburg and Öresund got zero `ShipStaticData` messages in a full
  hour**, despite 132 and 51 unique vessels respectively — at the AIS
  spec's ~6-minute static broadcast interval that's a real gap, not
  sampling noise. Static/voyage data (and therefore vessel names) may be
  unreliable outside Stockholm on this feed; don't assume names will be
  populated NAS-wide once this adapter is enabled. Worth a longer/repeat
  capture before relying on this for the vessel-sheet feature (Phase 3).
- **This one connection stayed comfortably within AISStream's limits**
  (all 3 boxes, zero reconnects) — no evidence yet that 3 separate
  connections (one per box) would behave differently, but that wasn't
  tested.
- **Storage**: ~1.75 GB estimated for 90 days across all three boxes at
  this rate (rough per-row estimate, not a measured row size) — small
  enough that `POSITION_RETENTION_DAYS=90`'s default isn't a concern for
  this coverage area. Recheck this if the coverage area grows
  significantly (e.g. adding the rest of the Baltic).

## BarentsWatch

- Capture status: **not run**. Needs normalization fixtures run against
  representative messages; document token lifetime and reconnect behavior.
- Terms review: **not done**.
- Docs: https://developer.barentswatch.no/docs/AIS/live-ais-api/

## AISHub

**Blocked, checked 2026-09-02 — requires a receiver we don't have.**
AISHub is not a signup-and-get-a-key service: it's a contributor-based
network. Their own application guidance: "Applications without an
operational AIS station and feed will not be approved." Concretely, to
even apply for API access you must already be *running and sharing your
own AIS receiver*, with a 7-day track record meeting: 10+ vessels average
coverage, 90%+ uptime, ≤60s downsampling, ≤10s message delay. There is no
path to an AISHub API key without first owning and operating physical AIS
receiver hardware for at least a week. Per the PRD's own scoping for this
adapter ("Interface and config schema only unless credentials/feed access
are available"), no adapter code exists for this — there's nothing to
build against without real access. Docs: https://www.aishub.net/api,
https://www.aishub.net/join-us.

If a local SDR receiver is ever set up (see "local receiver" below), it
would simultaneously unlock this path — feed AISHub for a week at the
required quality bar and re-apply.

## Local receiver (Sweden coverage)

Post-V1 per the PRD scope table — no spike scheduled. Would need an SDR
dongle + antenna with a view of water, plus receiver software (e.g.
AIS-catcher) feeding an authenticated ingress into this pipeline (PRD
SS12: "never expose UDP directly to internet"). Not pursued yet — would
require buying and physically setting up hardware.

## Licensed Sweden (future)

Not a V1 dependency per the PRD (SS21) — no commercial/access decision
made, no spike scheduled.

## Storage sizing

Not estimated yet — depends on the AISStream capture volume (PRD SS12.1,
"estimate position volume and 90-day storage from the capture before
setting production defaults"). `POSITION_RETENTION_DAYS=90` in
`.env.example` is the PRD's suggested starting default, not a measured one.
