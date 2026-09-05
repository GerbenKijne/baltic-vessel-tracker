# ADR-0007: Email and webhook alert delivery

- Status: Accepted
- Date: 2026-09-05

## Context

Alerts only ever landed in the in-app event log. The rule builder's
"Channels" section already had Email/Webhook rows in the UI, but they
were hardcoded off (`title="Not built yet"`) with no backend field
behind them at all. Migration `0001_initial_schema` had already created
a `notification_deliveries` table (`event_id, channel, attempt, status,
next_attempt_at, error`) as forward-looking scaffolding for exactly this
feature, per docs/adr/0001 — nothing ever wrote to it until now.

## Decisions

- **Delivery is queued in the same transaction as the event, then sent
  by a separate periodic loop — both inside `worker-ingest`.**
  `alerts.py`'s `_fire()` already has a single choke point (the
  `alert_events` insert's `ON CONFLICT DO NOTHING` `rowcount` check) that
  distinguishes a genuine new firing from a replayed/duplicate
  transition; it now also inserts one `notification_deliveries` row per
  configured channel there. A new `notify.py` module runs
  `notify_loop()` alongside the existing `alerts_loop()`/`retention_loop()`
  in the same `asyncio.gather(...)` (`worker/main.py`), polling for due
  deliveries every 15s. This keeps evaluation and delivery as two
  independent concerns in one process (no new service, matching
  ADR-0003's bias) while still giving delivery its own retry/backoff
  loop separate from position-evaluation's per-message cadence — a
  failed webhook must never slow down alert evaluation.
- **Retry with backoff, not fire-and-forget.** Each delivery attempt
  updates `attempt`/`status`/`next_attempt_at`/`error` on its
  `notification_deliveries` row: `sent` on success; `retrying` with
  `next_attempt_at = now() + min(2^attempt * 30, 3600)` seconds on
  failure, up to 5 attempts, then `failed` for good. An email channel
  with no `smtp_settings` configured fails immediately as `failed`
  instead of entering the retry loop — it structurally cannot succeed
  until an admin configures SMTP, and retrying every 15s forever for
  that reason would just be noise.
- **Rule-level channel config lives in first-class columns
  (`alert_rules.email_to`, `webhook_url`, `webhook_secret`), not inside
  `params`/`target`.** Those two JSONB columns are reserved for
  *trigger-condition* data (per ADR-0006); channels are a "what happens
  when it fires" concern, same category as `add_to_watchlist_id`
  (migration `0007`), which made the identical call. `email_to`/
  `webhook_url` are "always sent, `None` means disabled" fields exactly
  like `add_to_watchlist_id`; `webhook_secret` instead follows
  `DataSourceConfig.api_key`'s convention (never echoed back by the API,
  `None` on update means "leave unchanged") since the frontend can't
  round-trip a value it's never shown. Clearing `webhook_url` also
  clears any stored secret server-side — a secret with nowhere to send
  it is dead weight.
- **Webhook payloads are signed, not just POSTed.** `X-Signature:
  sha256=<hex>` is an HMAC-SHA256 over the raw JSON body using the
  rule's secret, following the same convention as GitHub/Stripe-style
  webhooks so receivers have a standard pattern to verify against. The
  secret is optional — an operator posting to a private/trusted endpoint
  can skip it — but recommended.
- **SMTP settings are a global singleton (`smtp_settings`, id=1), not
  per-rule.** One deployment has one outbound mailbox; modeled directly
  on `retention_settings` (migration `0003`)'s singleton-row pattern,
  masked the same way as `DataSourceConfig.api_key`.
- **A synchronous `POST /admin/smtp-settings/test-email` endpoint lives
  in `apps/api`, separate from the async retry path in `workers/ingest`.**
  An operator configuring SMTP wants immediate pass/fail feedback, not
  "check back in 15 seconds and look at the worker's logs." This means
  `aiosmtplib`'s send call is duplicated in both services rather than
  shared — an acceptable small duplication given `packages/contracts` is
  scoped to the canonical AIS event schema, not general shared code, and
  the alternative (routing a "test" through the real delivery queue) adds
  latency and a fake-event special case for no real benefit.

## Consequences

- A future contributor adding a third channel (Slack, SMS, ...) should
  extend the same pattern: a first-class nullable column or two on
  `alert_rules`, a case in `_fire()`'s channel-queuing, a case in
  `notify.py`'s dispatch — not a new table or a parallel delivery path.
- There's no UI for browsing `notification_deliveries` (attempt history,
  last error) — an operator debugging a failed delivery today needs
  `psql` or the worker's logs. Worth adding if delivery failures turn
  out to be common enough that the in-app event log (which only shows
  that a rule *fired*, not whether email/webhook delivery succeeded)
  isn't enough.
- `notify_loop`'s claim step (mark due rows `sending` before dispatch)
  assumes a single `worker-ingest` instance, same assumption
  `evaluate_stale_alerts`'s sweep already makes — it would need `FOR
  UPDATE SKIP LOCKED` to be safe if this worker were ever scaled to
  multiple replicas.
