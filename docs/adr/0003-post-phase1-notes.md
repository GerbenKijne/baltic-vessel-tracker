# ADR-0003: Post-Phase-1 architecture notes

- Status: Accepted
- Date: 2026-09-03

## Context

ADR-0001 and ADR-0002 describe the Phase 1 walking skeleton and the
AISStream adapter as they stood on 2026-09-02. Since then the project
has grown well past that original phased plan (Watchlists, History,
Alerts, and Admin — originally Phase 3/4 scope — all shipped), driven by
actually using the deployed app rather than working strictly in phase
order. This ADR records the real architectural decisions made along the
way that either deviate from ADR-0001's plan or aren't written down
anywhere else, rather than editing those two ADRs after the fact.

## Decisions

- **Alert rule evaluation lives inside `worker-ingest`, not a separate
  `worker-alerts` service.** ADR-0001 planned `workers/alerts` as its
  own stubbed package for Phase 4. When alerts actually got built, the
  rule engine (`workers/ingest/worker/alerts.py`) went into the
  already-running ingest worker instead: geofence/speed rules need to
  evaluate against every accepted position update inline, and stale
  rules just need a periodic sweep — neither needed a separate
  long-running process, Redis consumer group, or deployment unit. One
  already-continuous worker, no new infrastructure. `workers/alerts/`
  remains on disk as an empty, untracked leftover from the original
  scaffolding; nothing depends on it.
- **Alert/geofence persistence uses raw SQL, not the Core-table-mirror
  pattern.** The rest of `workers/ingest` mirrors `apps/api`'s ORM
  schema by hand in `worker/tables.py` (documented there as a real,
  accepted maintenance cost). `worker/alerts.py` instead writes
  parameterized SQL directly against `alert_rules`/`alert_events`/
  `geofences` — the JSONB target/params matching and PostGIS containment
  checks read more clearly as explicit SQL, and it's one less table
  definition to hand-sync for a feature this narrow.
- **Position retention settings are database-backed and live-editable,
  not static env config.** A `retention_settings` singleton row (Admin
  page's "Retention & storage" section writes to it) is read fresh by
  `worker/retention.py` on every sweep. The env vars
  (`RETENTION_DEFAULT_HOURS` etc.) only matter as a fallback if that row
  is ever missing. This wasn't the original plan (there wasn't one —
  retention was added once real AIS traffic made unbounded
  `position_observations` growth an actual, not hypothetical, problem);
  recorded here because "where does the real value come from" isn't
  obvious from the env var names alone.
- **AIS coverage area evolved from three small boxes to the entire
  Baltic Sea**, in two steps (Stockholm/Gothenburg/Öresund → Stockholm/
  Gotland/Åland/southern Finland → the whole Baltic), each the user's
  own explicit choice as the project's scope grew from "prove the
  pipeline works" to "actually track ships I care about." Each step is
  recorded in `docs/data-source-register.md` and
  `workers/ingest/worker/config.py`'s own comments; only the current
  (whole-Baltic) box is live. Expect materially more traffic and
  database growth than the original capture spike's numbers reflect —
  the retention sweep above is what keeps that bounded, not a smaller
  box.
- **A full design-system redesign replaced the Phase 1 UI**, built
  against an external design handoff (tokens, typography, a MapLibre-
  based floating-panel Map layout) rather than the PRD's own visual
  spec, which didn't go into that level of detail. Deliberately *not*
  pixel-matched everywhere: Alerts/Admin/History either didn't exist yet
  or only had placeholder content when the redesign landed, so they were
  built later against the same token system rather than against
  specific mockups for those screens.
- **The PRD's phase numbering stopped being a literal build order.**
  Alerts, Watchlists, History, and Admin — nominally Phase 3/4 — all
  shipped essentially at once, prioritized by what was actually useful
  to have next rather than by the PRD's original sequencing. Treat
  "Phase N" references in the PRD and in ADR-0001/0002 as historical
  context for *why* something was scoped the way it was on the day it
  was written, not as a current roadmap.

## Consequences

- Anyone extending alert rules should keep evaluation logic in
  `worker/alerts.py` inline with the ingest loop (or its periodic sweep
  for anything without a triggering message), not spin up a new service
  for it, unless a specific rule type genuinely needs independent
  scaling or a different failure domain.
- `docs/data-source-register.md` and `workers/ingest/worker/config.py`
  are the sources of truth for *current* coverage and retention
  settings; ADR-0002's bounding-box mention and the original capture
  numbers are historical record for the 2026-09-02 capture, not live
  configuration — don't update them to match later changes.
- A future contributor should expect the actual codebase to be ahead of
  the PRD in scope (Watchlists/History/Alerts/Admin) while still behind
  it in a few explicitly-deferred places (freeform polygon geofences,
  email/webhook alert delivery, multi-tenant accounts, a second live
  data source) — check `README.md`'s "What's built" section for the
  current honest state rather than inferring it from the PRD alone.
