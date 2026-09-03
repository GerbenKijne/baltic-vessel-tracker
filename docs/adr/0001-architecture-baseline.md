# ADR-0001: Architecture baseline for the Phase 1 walking skeleton

- Status: Accepted (see [ADR-0003](0003-post-phase1-notes.md) for
  decisions made after this one, including a couple of deviations from
  the plan below)
- Date: 2026-09-02

## Context

The PRD (`docs/Baltic_Vessel_Tracker_PRD.docx`) specifies a provider-agnostic,
self-hosted AIS tracker built as vertical slices, starting with a Phase 1
"walking skeleton": Compose stack, auth, migrations, canonical schema, a
simulator adapter, health/metrics, and a basic live map, with the exit gate
"a simulated event reaches the map through the full pipeline."

This repo has no local Docker or Postgres available during development
(macOS host, Homebrew broken). CI (GitHub Actions) is therefore the primary
place end-to-end and container-build verification happens; local development
is limited to per-service unit tests and `npm run build`/`tsc` for the
frontend.

## Decisions

- **Monorepo layout** follows PRD SS20 verbatim: `apps/web`, `apps/api`,
  `workers/ingest`, `workers/alerts` (stubbed until Phase 4),
  `packages/contracts`, `packages/test-fixtures`, `infra/compose`,
  `migrations` (kept inside `apps/api` since Alembic is API-owned),
  `docs/adr`, `docs/runbooks`, `tests/e2e`, `tests/performance`.
- **Event transport**: Redis Streams (`vessel-updates`), per PRD SS8 — chosen
  over NATS/Kafka as the simplest option that still decouples ingestion from
  the WebSocket fan-out, matching SS20.1 ("prefer simple, reversible
  technology choices").
- **Contracts**: hand-maintained parallel Pydantic (`packages/contracts/python`)
  and TypeScript (`packages/contracts/typescript`) modules for now. OpenAPI-
  generated codegen (as PRD SS20 recommends) is deferred to Phase 3 when the
  API surface stabilizes — tracked as a follow-up, not a rejection.
- **Auth**: local admin bootstrap from environment variables on first boot,
  Argon2id password hashing, server-side sessions stored in Redis, CSRF via
  double-submit cookie for cookie-authenticated mutations. No JWT — sessions
  are revocable, which matters more than statelessness for a single-tenant
  self-hosted app.
- **Realtime**: one WebSocket endpoint (`/api/v1/live`) per PRD SS11.1
  message shapes (`subscription.replace`, `snapshot.begin/end`,
  `vessel.upsert`, heartbeat every 25s). Viewport bbox filtering happens
  server-side at publish time.
- **Database**: PostgreSQL 16 + PostGIS. The Phase 1 migration creates the
  full PRD SS10 schema (including `geofences`, `alert_rules`,
  `alert_events`, `notification_deliveries`, `source_status`) even though
  most of those tables stay unused until Phase 4, to avoid churn on a shared
  schema later. `TimescaleDB` and partitioning are explicitly deferred
  (PRD SS20.1: don't add infrastructure without a measured need).
- **Simulator adapter**: the only adapter wired up in Phase 1.
  AISStream/BarentsWatch adapters and their mandatory pre-build spikes
  (PRD SS12.1) are Phase 2 work and require real provider credentials and a
  licence review this ADR does not attempt to shortcut.
- **`worker-alerts`** exists as a placeholder package only; the rule engine
  is Phase 4 scope per the PRD's phased plan and is intentionally not built
  now.

## Consequences

- The API and worker share the canonical contract by convention, not by
  generated code, until Phase 3. A drift test (`packages/test-fixtures`)
  should be added before then.
- Because there's no local Postgres/Docker on the primary dev machine, CI
  is load-bearing for verifying the Compose stack and container builds —
  treat a red CI run as blocking, not advisory.
- Deployment target (a self-hosted always-on machine, per the user) is not
  yet configured; `infra/compose` is written to be host-agnostic (bind
  mounts avoided, all config via `.env`) so that decision can be made later
  without reshaping the compose files.
