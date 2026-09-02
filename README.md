# Baltic Vessel Tracker

Self-hosted, provider-agnostic live AIS vessel tracking for Sweden, the
Baltic, and Norway. Full requirements: [docs/Baltic_Vessel_Tracker_PRD.docx](docs/Baltic_Vessel_Tracker_PRD.docx).

**Not for navigation.** Data may be delayed, incomplete, duplicated,
spoofed, or incorrect.

## Status

Phase 1 walking skeleton (see the PRD's phased plan, SS19, and
[docs/adr/0001-architecture-baseline.md](docs/adr/0001-architecture-baseline.md)):
auth, the full canonical database schema, a simulated AIS feed, and a live
map are wired end to end. Live provider adapters (AISStream, BarentsWatch),
watchlists, history, geofences/alerts, and hardening are not built yet —
see [docs/data-source-register.md](docs/data-source-register.md) and the
PRD for what's still required before any real provider is enabled.

## Stack

- `apps/web` — React + TypeScript + Vite + MapLibre GL JS
- `apps/api` — FastAPI, WebSocket realtime gateway, Alembic migrations
- `workers/ingest` — provider adapters, normalization, dedupe, persistence
- `workers/alerts` — placeholder; rule engine is Phase 4
- `packages/contracts` — shared canonical event schema (Python + TypeScript)
- PostgreSQL 16 + PostGIS, Redis (streams + cache), optional Caddy TLS proxy

## Running it locally

Requires Docker and Docker Compose. This repo's own dev machine has neither
available, so this stack is validated in CI (`.github/workflows/ci.yml`),
not locally — see docs/adr/0001 for why.

```bash
cp .env.example .env   # then edit it — set a real password and admin login
docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
```

Then open http://localhost:8090 (or whatever `WEB_PORT` you set in `.env`)
and sign in with the
`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` from `.env`. You should
see a handful of simulated vessels moving around the Stockholm archipelago
within a few seconds.

Full instructions: [docs/runbooks/deploy.md](docs/runbooks/deploy.md).

## Developing without Docker

The frontend can be worked on standalone:

```bash
cd apps/web
npm install
npm run dev
```

It expects the API at `localhost:8000` (see `vite.config.ts`'s proxy
config) — run `apps/api` separately against a Postgres+Redis you have
access to, or just use the full Compose stack.

The API and worker each have their own dependency/test setup:

```bash
cd apps/api && pip install -r requirements-dev.txt && ruff check . && pytest
cd workers/ingest && pip install -r requirements-dev.txt && ruff check . && pytest
```

Their unit tests don't require a database or Redis; a few integration
tests (e.g. `workers/ingest/tests/test_integration_dedupe.py`) skip
themselves when `TEST_REDIS_URL`/`TEST_DATABASE_URL` aren't set, which is
the case outside CI.

## Repo layout

See [docs/adr/0001-architecture-baseline.md](docs/adr/0001-architecture-baseline.md)
for the reasoning; the layout itself follows the PRD's SS20 verbatim.
