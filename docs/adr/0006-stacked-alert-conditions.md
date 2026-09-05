# ADR-0006: Stacked alert conditions (speed + geofence together)

- Status: Accepted
- Date: 2026-09-07

## Context

Every alert rule had exactly one condition, picked by its `type`
(`geofence_enter`, `geofence_exit`, `stale`, `speed_above`), each reading
its own shape out of the `params` JSONB column. There was no way to
express "ships over 20kn inside this zone" — a genuinely different
condition from either "any speed inside this zone" (`geofence_enter`
fires on any transition regardless of speed) or "over 20kn anywhere"
(`speed_above` fires everywhere, not just in one area).

## Decisions

- **A second, optional condition reuses the *other* type's own params
  key, rather than inventing a combinator or a new rule type.** A
  `geofence_enter`/`geofence_exit` rule can set `params.threshold_kn`
  (normally `speed_above`'s key) to additionally require that speed at
  the moment of the transition. A `speed_above` rule can set
  `params.geofence_id` (normally the geofence types' key) to additionally
  require current containment. Both params can therefore appear on any
  position-based rule; `type` just says which one is the *trigger*
  (evaluated as a transition or threshold-crossing) and which, if
  present, is a *gate* (a plain true/false check applied once the
  trigger condition already passed). This was chosen over building a
  general AND/OR condition tree (a real rule-engine, with its own
  query-builder UI) as overkill for what was actually asked: combining
  exactly two specific conditions that already both exist, not arbitrary
  boolean composition.
- **Only these two conditions stack, not all four.** `stale` isn't
  offered a secondary condition — "went quiet while inside a geofence"
  is a coherent idea, but nobody asked for it, and stale rules run on a
  periodic sweep against last-known position rather than inline against
  a live one, so it would need different plumbing (checking
  `vessel_latest`'s stored position, not a fresh `lon`/`lat` argument) to
  do properly. Easy to add later against the same `params` pattern if
  it's ever wanted.
- **The gate is a plain additional check in `worker/alerts.py`'s
  existing `evaluate_position_alerts`, not a second query pass.** Both
  `lon`/`lat` (for the geofence gate) and `sog_kn` (for the speed gate)
  are already function arguments — no new data has to be fetched to
  evaluate either stacked condition. `_fire`'s `context` JSONB gains the
  gate's fields (e.g. a stacked speed_above event's context includes
  `geofence_id` alongside the usual `sog_kn`/`threshold_kn`) so an event
  in the inbox shows why it fired, not just that it did.
- **Frontend keeps the stacked condition in separate form fields from
  the primary one** (`alsoGeofenceId`/`alsoMinSpeedKn`, not reusing
  `geofenceId`/`speedThresholdKn`), even though both ultimately write the
  same `params` keys. Switching a rule's primary type in the builder
  shouldn't silently turn a leftover primary-field value into an
  unintended stacked condition.

## Consequences

- A future contributor adding a genuinely new *combinator* (OR, NOT, three
  stacked conditions, ...) should treat that as a different, larger
  feature — this ADR's approach doesn't generalize past "one optional
  gate on top of one trigger," by design.
- `AlertRuleOut.params` can now contain both `geofence_id` and
  `threshold_kn` regardless of `type`; any code reading `params` for
  display (e.g. `describeRule` in `AlertsPage.tsx`) needs to check for
  the *other* type's key too, not just assume `params` only ever matches
  its own rule type's primary shape.
