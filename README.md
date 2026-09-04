# Baltic Vessel Tracker

Self-hosted, provider-agnostic live AIS vessel tracking for the Baltic
Sea — a MarineTraffic-like map without a 5-vessel watchlist cap, that
you run yourself. Full original requirements:
[docs/Baltic_Vessel_Tracker_PRD.docx](docs/Baltic_Vessel_Tracker_PRD.docx)
(the project has since grown past that document's phased plan; this
README reflects what's actually built).

**Not for navigation.** Data may be delayed, incomplete, duplicated,
spoofed, or incorrect.

Licensed under [AGPL-3.0](LICENSE) — if you run a modified version of
this as a network service, you must make your changes' source available
to its users (see the LICENSE file for the exact terms).

## What's built

- **Live map** (MapLibre GL JS): vessel markers with heading-rotated
  arrows (shape carries movement state — arrow/square/circle — so
  freshness color is never the only signal), clustering below zoom 7,
  click-to-inspect detail drawer with the full identity/voyage sheet
  (ship type, IMO, callsign, dimensions, destination, ETA, draught, when
  the source has reported them), light/dark themes, mobile-responsive
  floating panels.
- **Watchlists**: save vessels to named lists, filter the map to just a
  list's members, CSV/GeoJSON export, CSV import.
  See [FR-014](docs/Baltic_Vessel_Tracker_PRD.docx).
- **History**: search any vessel this instance has ever recorded (not
  just ones currently live or watchlisted) and review its track over a
  chosen window, with gaps drawn honestly — never bridged into a fake
  straight-line path.
- **Alerts**: geofences (circles — draw on the map or enter coordinates,
  your choice) and rules (enter/exit/stale/speed-above), each with a
  cooldown and a target (all vessels / one vessel / a watchlist), firing
  into an in-app event inbox with acknowledgment. Email/webhook delivery
  and freeform polygon geofences aren't built.
- **Admin**: add/edit/enable/disable data sources (Admin -> Data sources
  — no env vars or restart-by-hand needed), per-adapter-instance source
  health (message/error/reconnect counts, manual cleanup of stale rows),
  and live-editable retention settings (how long position history is
  kept for watchlisted vs. ordinary vessels) with a database-size/row-count
  panel.
- **Ingestion pipeline**: adapter → parse → normalize → dedupe → persist
  → publish, with a canonical event schema shared between the API and
  worker. Zero, one, or several sources can run concurrently, each
  configured from the app itself rather than fixed at container start;
  see [Data sources](#data-sources) below.

Not built: multi-tenant accounts (this is a single-operator, invite-free
app — one admin login per deployment), a public/hosted demo, email or
webhook alert delivery, freeform polygon geofences.

## Stack

- `apps/web` — React + TypeScript + Vite + MapLibre GL JS + TanStack Query
- `apps/api` — FastAPI, WebSocket realtime gateway, Alembic migrations
- `workers/ingest` — provider adapters, normalization, dedupe,
  persistence, alert-rule evaluation, and the position-retention sweep
  all run in this one process (see
  [docs/adr/0003-post-phase1-notes.md](docs/adr/0003-post-phase1-notes.md)
  for why alert evaluation ended up here instead of a separate
  `workers/alerts` service, which was the original plan)
- `packages/contracts` — shared canonical event schema (Python + TypeScript)
- PostgreSQL 16 + PostGIS, Redis (streams + cache), optional Caddy TLS proxy

## Running it locally

Requires Docker and Docker Compose.

```bash
cp .env.example .env   # then edit it — set a real password and admin login
docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
```

Then open http://localhost:8090 (or whatever `WEB_PORT` you set in `.env`)
and sign in with the `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`
from `.env`. You should see a handful of simulated vessels moving around
the Stockholm archipelago within a few seconds — that's the `simulator`
data source, seeded automatically as the safe default for a fresh
install. To track real ships, add a source with a real API key from
Admin -> Data sources (a banner on the map points there too) — see
[Data sources](#data-sources) below.

Full instructions, including a Synology NAS walkthrough:
[docs/runbooks/deploy.md](docs/runbooks/deploy.md).

**Important:** always pass `--env-file .env` explicitly on every Compose
command, even ones that only touch one service. Without it, Compose
silently falls back to hardcoded defaults instead of erroring — a
service can end up running with the wrong password or the simulator
adapter instead of a real one, with no warning at all.

## Data sources

New deployers get one `simulator` source (no credentials, fake traffic)
until they decide otherwise. Adding, editing, enabling, and disabling
sources all happen from **Admin -> Data sources** in the app itself —
there is no env var for this anymore. A change there takes effect once
the ingest worker notices (checked every 20s) and restarts itself to
apply it; no manual `docker compose` command needed. Multiple sources
(the simulator plus a real one, or several real ones with different
bounding boxes) can run at the same time.

See [docs/data-source-register.md](docs/data-source-register.md) for the
full due-diligence record on each real provider considered:

- **AISStream** — built, and cleared to enable for this project's own
  deployment (no published Terms of Service exist for the AIS data
  itself; accepted as a reasonable risk for a small, non-commercial,
  self-hosted use — re-evaluate if that changes, e.g. going public or
  commercial). Each deployer needs their own free API key (paste it into
  Admin -> Data sources) and should make their own call on the terms gap
  first. Parses both Class A and Class B AIS messages, so sailboats and
  small craft show up alongside commercial traffic, not just the latter.
- **BarentsWatch** — investigated and ruled out as a second source: its
  open-data tier caps a subscription area at 500 km² and is restricted
  to Norwegian waters, neither of which meaningfully covers the Baltic.
- **AISHub** — blocked: contributor-only, requires already operating a
  physical AIS receiver for a week before they'll grant API access.
- **A local SDR receiver** — not pursued; would need hardware.

Default coverage for an AISStream source that doesn't set its own
bounding boxes (`workers/ingest/worker/config.py`'s
`DEFAULT_BOUNDING_BOXES`) is the entire Baltic Sea; the Admin form has an
optional "custom coverage area" field to override it per source.

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
the case outside CI. This repo's own dev environment has no local
Docker/Postgres either — CI (`.github/workflows/ci.yml`) is the real
integration test for the Compose stack and container builds; treat a red
CI run as blocking.

## Repo layout

See [docs/adr/0001-architecture-baseline.md](docs/adr/0001-architecture-baseline.md)
for the original reasoning (layout follows the PRD's SS20) and
[docs/adr/0003-post-phase1-notes.md](docs/adr/0003-post-phase1-notes.md)
for what's changed since.
