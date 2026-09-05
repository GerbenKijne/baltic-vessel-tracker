# ADR-0009: `DEMO_MODE` read-only guard

- Status: Accepted
- Date: 2026-09-05

## Context

The README listed "a public/hosted demo" as not built. Hosting a demo
(domain, TLS, who pays for it) is an operational decision that stays
the deployer's own — this ADR covers only the code needed to make
running one safe: a way to guarantee a publicly reachable instance
can't be tampered with, whoever's looking at it.

## Decisions

- **One dependency, stacked onto every existing mutating route, not a
  new auth layer.** `require_write_access` (`apps/api/app/deps.py`)
  raises 403 when `Settings.demo_mode` (env `DEMO_MODE`, default false)
  is set. It's appended to the same `dependencies=[...]` lists that
  already carry `require_csrf` across all 17 mutating routes in
  `alerts.py`, `watchlists.py`, and `admin.py` — purely additive, no
  handler signatures changed. `auth.py`'s `login`/`logout` are
  deliberately left alone; a read-only instance still needs to let
  people sign in.
- **This does not add anonymous access.** Demo mode only removes the
  ability to mutate anything — it does not relax `get_current_user`.
  Visitors still authenticate with whatever `BOOTSTRAP_ADMIN_EMAIL`/
  `PASSWORD` the operator set, and it's entirely on the operator to
  decide whether/how to publish that login. Building passwordless/guest
  access was out of scope for what was asked (a safe-to-share read-only
  mode), and would be a materially bigger change to the single-operator
  session model ADR-0001 chose.
- **The simulator needed no changes.** `SimulatorAdapter` was already
  fully deterministic (`fleet_size=12, seed=42` hardcoded defaults,
  unconditionally used by `sources.py`) — the same 12 vessels, names,
  and starting positions every run. A demo instance already shows
  believable, repeatable traffic without any of this feature's code;
  worth stating explicitly so it isn't mistaken for a gap later.
- **The frontend surfaces `demo_mode` via `UserOut`** (both `/auth/login`
  and `/auth/me` already return this shape) rather than a separate public
  endpoint — it's naturally available at the same moment the app already
  knows who's logged in, with no new request. A persistent banner
  (`AppShell`) and per-button `disabled` checks in `AlertsPage`,
  `WatchlistsPage`, and `AdminPage` avoid a round-trip 403 for something
  the UI already knows, while the server-side guard remains the actual
  enforcement — a modified frontend or a direct API call still gets 403
  either way.

## Consequences

- A future contributor adding a new mutating endpoint must remember to
  add `Depends(require_write_access)` alongside `Depends(require_csrf)`
  — there's no automatic enforcement (e.g. a router-level default) that
  would catch a forgotten one short of a dedicated test asserting the
  full route inventory.
- Read-only enforcement is all-or-nothing per deployment (one
  `DEMO_MODE` flag, one instance) — there's no per-user read-only role.
  Multi-tenant accounts (explicitly out of scope, see README) would be
  the real fix if finer-grained permissions are ever needed.
