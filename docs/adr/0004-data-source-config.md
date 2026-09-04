# ADR-0004: Admin-editable data sources, replacing env-var adapter config

- Status: Accepted
- Date: 2026-09-04

## Context

Since ADR-0001, exactly one ingest adapter ran per worker process,
chosen by the `INGEST_ADAPTER` env var and configured via
`AISSTREAM_API_KEY`/`AISSTREAM_BOUNDING_BOXES` — fixed at container
build/start time, changeable only by editing `.env` and recreating the
`worker-ingest` container by hand. That was fine while this project only
ever had one operator (the author) manually managing their own `.env`,
but it means there's no way for an admin to add a real data source from
the app itself, and no path for a self-hosted deployer to go from "demo
data" to "real ships" without shell access and a docker-compose command.

## Decisions

- **Data sources are rows in a new `data_sources` table, not env vars.**
  Each row has a name, adapter type (`simulator`/`aisstream`), an
  optional API key, optional bounding boxes, and an `enabled` flag,
  managed from the new Admin -> Data sources page
  (`apps/web/src/pages/AdminPage.tsx`). `INGEST_ADAPTER`,
  `AISSTREAM_API_KEY`, and `AISSTREAM_BOUNDING_BOXES` are gone from
  `.env.example`/`docker-compose.yml` entirely. Migration
  `0005_data_sources` seeds one `simulator` row so a fresh install still
  shows moving demo vessels immediately — it does not carry forward an
  existing deployment's env-configured `aisstream` key (the `migrate`
  container never had those env vars, and piping a real secret through
  it wasn't worth the coupling); anyone upgrading an existing deployment
  needs to re-enter their key once via the new page.
- **Multiple sources can run concurrently**, not just one adapter per
  process. `worker/main.py`'s `run()` now reads every *enabled* row at
  its own startup (`worker/sources.py`) and runs one `_ingest_loop` task
  per row via `asyncio.gather` — the simulator alongside a real source,
  or two real sources with different bounding boxes, all writing into
  the same tables at once. Each gets its own `source_status` identity
  (`{hostname}:{row id prefix}`) so their health doesn't collide.
  Explicitly the user's own choice over the simpler "exactly one active
  source" alternative, made when this ADR's design was discussed.
- **A config change needs a worker restart, applied automatically, not
  a live in-process reload.** Building a supervisor that starts/stops
  individual `asyncio.Task`s as `data_sources` rows change would work,
  but adds real complexity (task lifecycle, partial-failure states,
  double-starting an adapter racily) for a self-hosted single-operator
  app where a brief ingestion gap on change is a non-issue. Instead,
  `watch_for_changes` in `worker/sources.py` polls a cheap fingerprint
  (count + max `updated_at` of enabled rows) every 20 seconds and calls
  `os._exit(0)` the moment it differs from what this process started
  with; `docker-compose`'s `restart: unless-stopped` (already relied on
  everywhere else in this stack) brings the container back up, and the
  new startup reads the now-current table. Explicitly the user's own
  choice over building live add/remove-without-restart, made when this
  ADR's design was discussed.
- **API keys are stored in plaintext in Postgres**, the same trust model
  `.env` already had — whoever can reach this database or the Admin UI
  already has full admin access to this single-operator app, so
  encryption-at-rest would add a key-management problem (where does the
  master key live?) without changing who can actually read the secret.
  Explicitly the user's own choice over adding a `cryptography`
  dependency and an app-level encryption key, made when this ADR's
  design was discussed. The API never returns a stored key in a GET
  response — only a masked preview (`••••` + last 4 chars) — a cheap
  display-layer precaution independent of the storage decision.
- **The Admin UI directs a new operator toward adding a real source.**
  A banner on the Map page (`OnboardingBanner.tsx`) and a short
  numbered blurb on the Admin "Data sources" section both appear
  whenever no enabled source is anything but `simulator`, and disappear
  on their own once one is added — not a manual-dismiss notice, since
  the condition it describes resolves itself.

## Consequences

- `workers/ingest/worker/config.py`'s `WorkerConfig` no longer carries
  `adapter`/`aisstream_api_key`/`aisstream_bounding_boxes` — those three
  fields moved to `SourceConfig` rows built by `worker/sources.py` from
  the database, not env-loaded once at process start.
- A future contributor adding a new adapter type needs to: add it to
  `DATA_SOURCE_ADAPTERS` (`apps/api/app/schemas.py`) and the
  `ck_data_sources_adapter` CHECK constraint, add a case to
  `worker/sources.py`'s `build_adapter`, and add it to
  `ADAPTER_OPTIONS` in `AdminPage.tsx` — no env var, no compose file
  change, no Dockerfile change.
- Anyone scripting deployment (CI, a provisioning tool) that used to set
  `INGEST_ADAPTER`/`AISSTREAM_*` in a generated `.env` needs to instead
  call the new `POST /api/v1/admin/data-sources` endpoint once the stack
  is up — there is no equivalent env-var-only fully-automated path
  anymore, by design (this was always meant to be an admin, in-app
  action, not infrastructure config).
