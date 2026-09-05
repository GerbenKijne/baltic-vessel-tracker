import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { alertEventsApi } from "../api/alertEvents";
import {
  alertRulesApi,
  type AlertRule,
  type AlertRuleTarget,
  type AlertRuleType,
  type AlertRuleWrite,
  type AlertTargetKind,
} from "../api/alertRules";
import { geofencesApi, type Geofence } from "../api/geofences";
import { watchlistsApi, type Watchlist } from "../api/watchlists";
import { GeofenceMapView } from "../components/GeofenceMapView";
import { TopBar } from "../components/TopBar";
import { formatAgeForTime } from "../freshness";
import { useTheme } from "../ThemeContext";

const RULE_TYPE_LABEL: Record<AlertRuleType, string> = {
  geofence_enter: "Entered",
  geofence_exit: "Exited",
  stale: "Went stale",
  speed_above: "Speed exceeded",
};

const RULE_TYPE_SHORT: Record<AlertRuleType, string> = {
  geofence_enter: "Enter",
  geofence_exit: "Exit",
  stale: "Stale",
  speed_above: "Speed >",
};

const RULE_TYPE_COLOR: Record<AlertRuleType, string> = {
  geofence_enter: "var(--live)",
  geofence_exit: "var(--sel)",
  stale: "var(--delayed)",
  speed_above: "var(--stale)",
};

interface RuleFormState {
  name: string;
  type: AlertRuleType;
  targetKind: AlertTargetKind;
  targetMmsi: string;
  targetWatchlistId: string;
  geofenceId: string;
  staleMinutes: string;
  speedThresholdKn: string;
  // Stacked/secondary conditions (docs/adr/0006) -- kept as separate form
  // fields from geofenceId/speedThresholdKn above (rather than reusing
  // them) so switching the primary type in the form doesn't bleed a
  // leftover value into a condition the user never asked to add.
  alsoGeofenceId: string;
  alsoMinSpeedKn: string;
  cooldownMinutes: string;
  enabled: boolean;
  addToWatchlistId: string;
}

const EMPTY_FORM: RuleFormState = {
  name: "",
  type: "geofence_enter",
  targetKind: "all",
  targetMmsi: "",
  targetWatchlistId: "",
  geofenceId: "",
  staleMinutes: "15",
  speedThresholdKn: "20",
  alsoGeofenceId: "",
  alsoMinSpeedKn: "",
  cooldownMinutes: "30",
  enabled: true,
  addToWatchlistId: "",
};

function ruleToForm(rule: AlertRule): RuleFormState {
  const isGeofenceType = rule.type === "geofence_enter" || rule.type === "geofence_exit";
  return {
    name: rule.name,
    type: rule.type,
    targetKind: rule.target.kind,
    targetMmsi: rule.target.mmsi ?? "",
    targetWatchlistId: rule.target.watchlist_id ?? "",
    geofenceId: String(rule.params.geofence_id ?? ""),
    staleMinutes: String(rule.params.minutes ?? "15"),
    speedThresholdKn: String(rule.params.threshold_kn ?? "20"),
    alsoGeofenceId: !isGeofenceType ? String(rule.params.geofence_id ?? "") : "",
    alsoMinSpeedKn: isGeofenceType ? String(rule.params.threshold_kn ?? "") : "",
    cooldownMinutes: String(Math.round(rule.cooldown_seconds / 60)),
    enabled: rule.enabled,
    addToWatchlistId: rule.add_to_watchlist_id ?? "",
  };
}

function describeRule(rule: AlertRule, watchlists: Watchlist[], geofences: Geofence[]): string {
  const target =
    rule.target.kind === "all"
      ? "all vessels"
      : rule.target.kind === "vessel"
        ? `MMSI ${rule.target.mmsi}`
        : "a watchlist";
  let base = `${RULE_TYPE_SHORT[rule.type].toLowerCase()} · ${target}`;
  const isGeofenceType = rule.type === "geofence_enter" || rule.type === "geofence_exit";
  if (isGeofenceType && rule.params.threshold_kn != null) {
    base += ` · over ${rule.params.threshold_kn}kn`;
  } else if (rule.type === "speed_above" && rule.params.geofence_id) {
    const fence = geofences.find((g) => g.id === rule.params.geofence_id);
    base += ` · in ${fence?.name ?? "a geofence"}`;
  }
  if (!rule.add_to_watchlist_id) return base;
  const list = watchlists.find((w) => w.id === rule.add_to_watchlist_id);
  return `${base} · ★ adds to ${list?.name ?? "a list"}`;
}

export function AlertsPage() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({ queryKey: ["alert-rules"], queryFn: alertRulesApi.list });
  const geofencesQuery = useQuery({ queryKey: ["geofences"], queryFn: geofencesApi.list });
  const watchlistsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });

  const [eventsFilter, setEventsFilter] = useState<"all" | "unacknowledged">("all");
  const eventsQuery = useQuery({
    queryKey: ["alert-events", eventsFilter],
    queryFn: () => alertEventsApi.list(eventsFilter === "unacknowledged" ? false : undefined),
    refetchInterval: 15_000,
  });

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const [gfName, setGfName] = useState("");
  const [gfLat, setGfLat] = useState("");
  const [gfLon, setGfLon] = useState("");
  const [gfRadiusKm, setGfRadiusKm] = useState("");
  const [gfError, setGfError] = useState<string | null>(null);

  const gfCenterLon = gfLon.trim() && Number.isFinite(Number(gfLon)) ? Number(gfLon) : null;
  const gfCenterLat = gfLat.trim() && Number.isFinite(Number(gfLat)) ? Number(gfLat) : null;
  const gfRadiusM =
    gfRadiusKm.trim() && Number.isFinite(Number(gfRadiusKm)) ? Number(gfRadiusKm) * 1000 : null;

  function handleMapDraw(centerLon: number, centerLat: number, radiusM: number | null) {
    setGfLon(centerLon.toFixed(5));
    setGfLat(centerLat.toFixed(5));
    setGfRadiusKm(radiusM != null ? (radiusM / 1000).toFixed(2) : "");
    setGfError(null);
  }

  const createRuleMutation = useMutation({
    mutationFn: alertRulesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      setEditingRuleId(null);
    },
    onError: () => setFormError("Failed to save — try again."),
  });
  const updateRuleMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<AlertRuleWrite> }) =>
      alertRulesApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      setEditingRuleId(null);
    },
    onError: () => setFormError("Failed to save — try again."),
  });
  const deleteRuleMutation = useMutation({
    mutationFn: alertRulesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      setEditingRuleId(null);
    },
  });
  const createGeofenceMutation = useMutation({
    mutationFn: geofencesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofences"] });
      setGfName("");
      setGfLat("");
      setGfLon("");
      setGfRadiusKm("");
      setGfError(null);
    },
    onError: () => setGfError("Failed to create — try again."),
  });
  const deleteGeofenceMutation = useMutation({
    mutationFn: geofencesApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["geofences"] }),
    onError: () => alert("Couldn't delete this geofence — check it isn't used by a rule."),
  });
  const acknowledgeMutation = useMutation({
    mutationFn: alertEventsApi.acknowledge,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-events"] }),
  });

  const rules = rulesQuery.data ?? [];
  const geofences = geofencesQuery.data ?? [];
  const watchlists = watchlistsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const unacknowledgedCount = events.filter((e) => !e.acknowledged_at).length;
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  function handleNewRule() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingRuleId("new");
  }

  function handleSelectRule(rule: AlertRule) {
    setForm(ruleToForm(rule));
    setFormError(null);
    setEditingRuleId(rule.id);
  }

  function buildPayload(): AlertRuleWrite | null {
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return null;
    }
    let target: AlertRuleTarget;
    if (form.targetKind === "all") {
      target = { kind: "all" };
    } else if (form.targetKind === "vessel") {
      if (!form.targetMmsi.trim()) {
        setFormError("Enter an MMSI.");
        return null;
      }
      target = { kind: "vessel", mmsi: form.targetMmsi.trim() };
    } else {
      if (!form.targetWatchlistId) {
        setFormError("Choose a watchlist.");
        return null;
      }
      target = { kind: "watchlist", watchlist_id: form.targetWatchlistId };
    }

    let params: Record<string, number | string> = {};
    if (form.type === "geofence_enter" || form.type === "geofence_exit") {
      if (!form.geofenceId) {
        setFormError("Choose a geofence.");
        return null;
      }
      params = { geofence_id: form.geofenceId };
      // Stacked/secondary condition (docs/adr/0006): optionally also
      // require a minimum speed at the moment of the transition.
      if (form.alsoMinSpeedKn.trim()) {
        const minSpeed = Number(form.alsoMinSpeedKn);
        if (!Number.isFinite(minSpeed) || minSpeed <= 0) {
          setFormError("The extra speed condition must be a positive number.");
          return null;
        }
        params.threshold_kn = minSpeed;
      }
    } else if (form.type === "stale") {
      const minutes = Number(form.staleMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        setFormError("Enter a positive number of minutes.");
        return null;
      }
      params = { minutes };
    } else if (form.type === "speed_above") {
      const threshold = Number(form.speedThresholdKn);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        setFormError("Enter a positive speed threshold.");
        return null;
      }
      params = { threshold_kn: threshold };
      // Stacked/secondary condition (docs/adr/0006): optionally also
      // require the vessel be inside a geofence.
      if (form.alsoGeofenceId) {
        params.geofence_id = form.alsoGeofenceId;
      }
    }

    const cooldownMinutes = Number(form.cooldownMinutes);
    if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 1) {
      setFormError("Cooldown must be at least 1 minute.");
      return null;
    }

    setFormError(null);
    return {
      name: form.name.trim(),
      type: form.type,
      target,
      params,
      cooldown_seconds: Math.round(cooldownMinutes * 60),
      enabled: form.enabled,
      add_to_watchlist_id: form.addToWatchlistId || null,
    };
  }

  function handleSaveRule() {
    const payload = buildPayload();
    if (!payload) return;
    if (editingRuleId === "new") {
      createRuleMutation.mutate(payload);
    } else if (editingRuleId) {
      updateRuleMutation.mutate({ id: editingRuleId, body: payload });
    }
  }

  function handleDeleteRule() {
    if (editingRuleId && editingRuleId !== "new" && confirm("Delete this rule?")) {
      deleteRuleMutation.mutate(editingRuleId);
    }
  }

  function handleCreateGeofence() {
    const lat = Number(gfLat);
    const lon = Number(gfLon);
    const radiusKm = Number(gfRadiusKm);
    if (!gfName.trim()) {
      setGfError("Name is required.");
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setGfError("Latitude must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setGfError("Longitude must be between -180 and 180.");
      return;
    }
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      setGfError("Radius must be a positive number.");
      return;
    }
    createGeofenceMutation.mutate({
      name: gfName.trim(),
      center_lat: lat,
      center_lon: lon,
      radius_m: radiusKm * 1000,
    });
  }

  return (
    <>
      <TopBar title="Alerts" crumb={`${unacknowledgedCount} unacknowledged`} />
      <div className="body">
        <aside className="side" aria-label="Rules">
          <div className="ssect">
            <div className="eyebrow">Rules</div>
          </div>
          <div>
            {rules.length === 0 && (
              <div style={{ padding: "10px 13px", fontSize: 11, color: "var(--faint)" }}>
                No rules yet.
              </div>
            )}
            {rules.map((rule) => (
              <button
                key={rule.id}
                className={`item ${editingRuleId === rule.id ? "on" : ""}`}
                onClick={() => handleSelectRule(rule)}
              >
                <span
                  className={`sw ${rule.enabled ? "on" : ""}`}
                  aria-hidden="true"
                  style={{ marginRight: 2 }}
                />
                <span>
                  <span style={{ fontSize: 12 }}>{rule.name}</span>
                  <br />
                  <span className="sub">{describeRule(rule, watchlists, geofences)}</span>
                </span>
                <span className="n">{rule.event_count}</span>
              </button>
            ))}
          </div>
          <div className="ssect" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <button className="btn pri sm" style={{ width: "100%" }} onClick={handleNewRule}>
              + New rule
            </button>
          </div>

          <div className="ssect">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Geofences
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {geofences.length === 0 && (
                <div style={{ fontSize: 11, color: "var(--faint)" }}>No geofences yet.</div>
              )}
              {geofences.map((g) => (
                <div key={g.id} className="alerts-geofence-row">
                  <span className="dot" />
                  <span style={{ fontSize: 11.5 }}>{g.name}</span>
                  <span className="sub" style={{ marginLeft: "auto" }}>
                    {(g.radius_m / 1000).toFixed(1)} km
                  </span>
                  <button
                    className="chip"
                    title="Delete geofence"
                    onClick={() => deleteGeofenceMutation.mutate(g.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
              <GeofenceMapView
                theme={theme}
                existingGeofences={geofences}
                centerLon={gfCenterLon}
                centerLat={gfCenterLat}
                radiusM={gfRadiusM}
                onChange={handleMapDraw}
              />
              <input
                className="input"
                placeholder="Name"
                value={gfName}
                onChange={(e) => setGfName(e.target.value)}
              />
              <div style={{ display: "flex", gap: 5 }}>
                <input
                  className="input mono"
                  placeholder="Lat"
                  style={{ width: 0, flex: 1 }}
                  value={gfLat}
                  onChange={(e) => setGfLat(e.target.value)}
                />
                <input
                  className="input mono"
                  placeholder="Lon"
                  style={{ width: 0, flex: 1 }}
                  value={gfLon}
                  onChange={(e) => setGfLon(e.target.value)}
                />
              </div>
              <input
                className="input mono"
                placeholder="Radius (km)"
                value={gfRadiusKm}
                onChange={(e) => setGfRadiusKm(e.target.value)}
              />
              {gfError && <span style={{ color: "var(--stale)", fontSize: 10.5 }}>{gfError}</span>}
              <button className="btn sm" style={{ width: "100%" }} onClick={handleCreateGeofence}>
                + Add geofence
              </button>
            </div>
            <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 8 }}>
              Circles only for now — freeform polygon drawing isn't built yet.
            </div>
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Filter events">
              <button
                className={eventsFilter === "all" ? "on" : undefined}
                onClick={() => setEventsFilter("all")}
              >
                All
              </button>
              <button
                className={eventsFilter === "unacknowledged" ? "on" : undefined}
                onClick={() => setEventsFilter("unacknowledged")}
              >
                Unacknowledged
              </button>
            </div>
          </div>

          <div className="wrap" style={{ flex: 1, overflow: "auto" }}>
            {events.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: "var(--faint)" }}>
                No alert events{eventsFilter === "unacknowledged" ? " to acknowledge" : " yet"}.
              </div>
            )}
            {events.map((e) => {
              const color = RULE_TYPE_COLOR[e.rule_type as AlertRuleType] ?? "var(--live)";
              return (
                <div
                  key={e.id}
                  className={`ev ${selectedEventId === e.id ? "on" : ""}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelectedEventId(e.id)}
                >
                  <span
                    style={{
                      color: e.acknowledged_at ? "var(--faint)" : color,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    {e.acknowledged_at ? "○" : "●"}
                  </span>
                  <div>
                    <span style={{ color, fontWeight: 500 }}>
                      {RULE_TYPE_LABEL[e.rule_type as AlertRuleType] ?? e.rule_type}
                    </span>{" "}
                    <span style={{ fontWeight: 500 }}>{e.vessel_name ?? "Unknown"}</span>{" "}
                    <span className="sub">{e.mmsi}</span>
                    <span style={{ color: "var(--dim)" }}> — {e.rule_name}</span>
                  </div>
                  <div className="mono" style={{ color: "var(--dim)", fontSize: 11 }}>
                    {formatAgeForTime(e.occurred_at)} ago
                  </div>
                  <div className="meta">
                    <span>{new Date(e.occurred_at).toLocaleString()} UTC</span>
                    {e.acknowledged_at && <span>acknowledged</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedEvent && (
            <div
              style={{
                flex: "none",
                borderTop: "1px solid var(--line-soft)",
                background: "var(--bg1)",
                padding: "12px 14px",
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1 }}>
                <div className="eyebrow">Event context</div>
                <div style={{ fontSize: 13, fontWeight: 600, margin: "2px 0 6px" }}>
                  {selectedEvent.vessel_name ?? "Unknown"} —{" "}
                  {(
                    RULE_TYPE_LABEL[selectedEvent.rule_type as AlertRuleType] ??
                    selectedEvent.rule_type
                  ).toLowerCase()}{" "}
                  {selectedEvent.rule_name}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(selectedEvent.context).map(([k, v]) => (
                    <span key={k} className="tag">
                      {k}: {String(v)}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flex: "none" }}>
                {selectedEvent.acknowledged_at ? (
                  <button className="btn sm" disabled style={{ opacity: 0.5 }}>
                    Acknowledged
                  </button>
                ) : (
                  <button
                    className="btn pri sm"
                    onClick={() => acknowledgeMutation.mutate(selectedEvent.id)}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {editingRuleId && (
          <aside className="builder" aria-label="Rule builder">
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-soft)" }}>
              <div className="eyebrow">Rule builder</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {editingRuleId === "new" ? "New rule" : form.name || "Rule"}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center" }}>
                <span
                  className={`sw ${form.enabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={form.enabled}
                  aria-label="Enabled"
                  onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                  style={{ cursor: "pointer" }}
                />
                <span style={{ fontSize: 11, color: "var(--dim)" }}>
                  {form.enabled ? "Enabled" : "Disabled"}
                  {editingRuleId !== "new" &&
                    rules.find((r) => r.id === editingRuleId) && (
                      <> · {rules.find((r) => r.id === editingRuleId)!.event_count} events all-time</>
                    )}
                </span>
              </div>
            </div>

            <div className="fld">
              <label className="eyebrow" htmlFor="rname">
                Name
              </label>
              <input
                className="input"
                id="rname"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="fld">
              <span className="eyebrow" style={{ display: "block", marginBottom: 5 }}>
                Trigger
              </span>
              <div className="radio">
                {(Object.keys(RULE_TYPE_SHORT) as AlertRuleType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={form.type === t ? "on" : undefined}
                    onClick={() => setForm((f) => ({ ...f, type: t }))}
                  >
                    {RULE_TYPE_SHORT[t]}
                  </button>
                ))}
              </div>
              <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 6 }}>
                Evaluated on accepted state transitions only — a rejected or duplicate observation
                never fires a rule.
              </div>
            </div>

            {(form.type === "geofence_enter" || form.type === "geofence_exit") && (
              <div className="fld">
                <span className="eyebrow" style={{ display: "block", marginBottom: 5 }}>
                  Geofence
                </span>
                <select
                  className="input"
                  value={form.geofenceId}
                  onChange={(e) => setForm((f) => ({ ...f, geofenceId: e.target.value }))}
                >
                  <option value="">Choose a geofence…</option>
                  {geofences.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} — circle, {(g.radius_m / 1000).toFixed(1)} km
                    </option>
                  ))}
                </select>
                {geofences.length === 0 && (
                  <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 6 }}>
                    Add a geofence in the sidebar first.
                  </div>
                )}
              </div>
            )}

            {(form.type === "geofence_enter" || form.type === "geofence_exit") && (
              <div className="fld">
                <label className="eyebrow" htmlFor="ralsospeed">
                  Also require speed over (optional)
                </label>
                <span>
                  <input
                    id="ralsospeed"
                    className="input mono"
                    style={{ width: 80, textAlign: "right" }}
                    type="number"
                    min={0}
                    placeholder="none"
                    value={form.alsoMinSpeedKn}
                    onChange={(e) => setForm((f) => ({ ...f, alsoMinSpeedKn: e.target.value }))}
                  />{" "}
                  kn
                </span>
                <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 6 }}>
                  Stacks onto the geofence trigger — e.g. only fire if also moving above this speed
                  at the moment it {form.type === "geofence_enter" ? "enters" : "exits"}. Leave blank
                  to fire on the transition alone.
                </div>
              </div>
            )}

            {form.type === "stale" && (
              <div className="fld">
                <label className="eyebrow" htmlFor="rminutes">
                  No message for
                </label>
                <span>
                  <input
                    id="rminutes"
                    className="input mono"
                    style={{ width: 80, textAlign: "right" }}
                    type="number"
                    min={1}
                    value={form.staleMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, staleMinutes: e.target.value }))}
                  />{" "}
                  minutes
                </span>
              </div>
            )}

            {form.type === "speed_above" && (
              <div className="fld">
                <label className="eyebrow" htmlFor="rspeed">
                  Speed over
                </label>
                <span>
                  <input
                    id="rspeed"
                    className="input mono"
                    style={{ width: 80, textAlign: "right" }}
                    type="number"
                    min={1}
                    value={form.speedThresholdKn}
                    onChange={(e) => setForm((f) => ({ ...f, speedThresholdKn: e.target.value }))}
                  />{" "}
                  kn
                </span>
              </div>
            )}

            {form.type === "speed_above" && (
              <div className="fld">
                <label
                  className="eyebrow"
                  htmlFor="ralsogeofence"
                  style={{ display: "block", marginBottom: 5 }}
                >
                  Also require inside a geofence (optional)
                </label>
                <select
                  id="ralsogeofence"
                  className="input"
                  value={form.alsoGeofenceId}
                  onChange={(e) => setForm((f) => ({ ...f, alsoGeofenceId: e.target.value }))}
                >
                  <option value="">None — fire on speed alone</option>
                  {geofences.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} — circle, {(g.radius_m / 1000).toFixed(1)} km
                    </option>
                  ))}
                </select>
                <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 6 }}>
                  Stacks onto the speed trigger — e.g. only fire while also currently inside this
                  zone, not anywhere.
                </div>
              </div>
            )}

            <div className="fld">
              <span className="eyebrow" style={{ display: "block", marginBottom: 5 }}>
                Applies to
              </span>
              <div className="radio">
                <button
                  type="button"
                  className={form.targetKind === "all" ? "on" : undefined}
                  onClick={() => setForm((f) => ({ ...f, targetKind: "all" }))}
                >
                  All vessels
                </button>
                <button
                  type="button"
                  className={form.targetKind === "watchlist" ? "on" : undefined}
                  onClick={() => setForm((f) => ({ ...f, targetKind: "watchlist" }))}
                >
                  A watchlist
                </button>
                <button
                  type="button"
                  className={form.targetKind === "vessel" ? "on" : undefined}
                  onClick={() => setForm((f) => ({ ...f, targetKind: "vessel" }))}
                >
                  One vessel
                </button>
              </div>
              {form.targetKind === "watchlist" && (
                <select
                  className="input"
                  style={{ marginTop: 6 }}
                  value={form.targetWatchlistId}
                  onChange={(e) => setForm((f) => ({ ...f, targetWatchlistId: e.target.value }))}
                >
                  <option value="">Choose a watchlist…</option>
                  {watchlists.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.vessel_count})
                    </option>
                  ))}
                </select>
              )}
              {form.targetKind === "vessel" && (
                <input
                  className="input mono"
                  style={{ marginTop: 6 }}
                  placeholder="MMSI"
                  value={form.targetMmsi}
                  onChange={(e) => setForm((f) => ({ ...f, targetMmsi: e.target.value }))}
                />
              )}
            </div>

            <div className="fld">
              <label
                className="eyebrow"
                htmlFor="rcooldown"
                style={{ display: "block", marginBottom: 5 }}
              >
                Cooldown
              </label>
              <span>
                <input
                  id="rcooldown"
                  className="input mono"
                  style={{ width: 80, textAlign: "right" }}
                  type="number"
                  min={1}
                  value={form.cooldownMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: e.target.value }))}
                />{" "}
                minutes
              </span>
              <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 6 }}>
                At most one notification per rule/vessel within this window.
              </div>
            </div>

            <div className="fld">
              <label
                className="eyebrow"
                htmlFor="raddtolist"
                style={{ display: "block", marginBottom: 5 }}
              >
                Also add to a list
              </label>
              <select
                id="raddtolist"
                className="input"
                value={form.addToWatchlistId}
                onChange={(e) => setForm((f) => ({ ...f, addToWatchlistId: e.target.value }))}
              >
                <option value="">Don't add anywhere — just alert</option>
                {watchlists.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <div style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 6 }}>
                Every vessel this rule fires for gets added here too — a way to auto-curate a list
                from a geofence or other rule.
              </div>
            </div>

            <div className="fld">
              <span className="eyebrow" style={{ display: "block", marginBottom: 5 }}>
                Channels
              </span>
              <div style={{ display: "grid", gap: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="sw on" role="switch" aria-checked="true" />
                  <span style={{ fontSize: 12 }}>In-app event log</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.5 }}>
                  <span className="sw" role="switch" aria-checked="false" />
                  <span style={{ fontSize: 12 }} title="Not built yet">
                    Email
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.5 }}>
                  <span className="sw" role="switch" aria-checked="false" />
                  <span style={{ fontSize: 12 }} title="Not built yet">
                    Webhook
                  </span>
                </div>
              </div>
            </div>

            {formError && (
              <div style={{ padding: "0 14px", color: "var(--stale)", fontSize: 11.5 }}>
                {formError}
              </div>
            )}

            <div style={{ padding: "12px 14px", display: "flex", gap: 7 }}>
              <button className="btn pri" style={{ flex: 1 }} onClick={handleSaveRule}>
                Save rule
              </button>
              {editingRuleId !== "new" && (
                <button className="btn" onClick={handleDeleteRule}>
                  Delete
                </button>
              )}
              <button className="btn" onClick={() => setEditingRuleId(null)}>
                Cancel
              </button>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
