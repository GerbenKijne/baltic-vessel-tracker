import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { dataSourcesApi, type DataSource } from "../api/dataSources";
import { retentionApi, storageApi } from "../api/retention";
import { smtpSettingsApi } from "../api/smtpSettings";
import { sourcesApi } from "../api/sources";
import { useAuth } from "../AuthContext";
import { ConfirmButton } from "../components/ConfirmButton";
import { TopBar } from "../components/TopBar";
import { formatAgeForTime } from "../freshness";
import { isSourceDegraded, sourceLabel } from "../sourceLabels";
import { useBodyClassWhen } from "../useBodyClass";

const ADAPTER_OPTIONS = [
  { value: "simulator", label: "Simulator (demo data)" },
  { value: "aisstream", label: "AISStream (real AIS traffic)" },
];

// Matches workers/ingest/worker/sources.py's WATCH_INTERVAL_SECONDS, plus
// a moment for the container to actually restart.
const WATCH_INTERVAL_LABEL = "a minute";

function DataSourceKeyUpdater({ source, disabled }: { source: DataSource; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => dataSourcesApi.update(source.id, { api_key: key }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      setKey("");
      setStatus("Updated.");
    },
    onError: () => setStatus("Failed — try again."),
  });

  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <input
        className="input mono"
        style={{ width: 160 }}
        type="password"
        placeholder="New API key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button
        className="btn sm"
        disabled={disabled || !key.trim() || mutation.isPending}
        onClick={() => {
          setStatus(null);
          mutation.mutate();
        }}
      >
        Update key
      </button>
      {status && <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{status}</span>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export function AdminPage() {
  const { demoMode } = useAuth();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useBodyClassWhen("sheet-open", sidebarOpen);

  const dataSourcesQuery = useQuery({ queryKey: ["data-sources"], queryFn: dataSourcesApi.list });
  const dataSources = dataSourcesQuery.data ?? [];
  const hasRealSource = dataSources.some((s) => s.enabled && s.adapter !== "simulator");

  const createSourceMutation = useMutation({
    mutationFn: dataSourcesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      setNewSourceName("");
      setNewSourceApiKey("");
      setUseCustomBoxes(false);
      setNewSourceFormError(null);
    },
    onError: (err) => setNewSourceFormError(err instanceof Error ? err.message : "Failed to add source"),
  });

  const toggleSourceMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      dataSourcesApi.update(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data-sources"] }),
  });

  const removeSourceMutation = useMutation({
    mutationFn: (id: string) => dataSourcesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data-sources"] }),
  });

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceAdapter, setNewSourceAdapter] = useState("aisstream");
  const [newSourceApiKey, setNewSourceApiKey] = useState("");
  const [useCustomBoxes, setUseCustomBoxes] = useState(false);
  const [customBoxesJson, setCustomBoxesJson] = useState(
    '[[[53.5, 9.0], [65.9, 30.5]]]'
  );
  const [newSourceFormError, setNewSourceFormError] = useState<string | null>(null);

  function handleAddSource() {
    setNewSourceFormError(null);
    if (!newSourceName.trim()) {
      setNewSourceFormError("Give this source a name.");
      return;
    }
    if (newSourceAdapter === "aisstream" && !newSourceApiKey.trim()) {
      setNewSourceFormError("AISStream needs an API key — get a free one at aisstream.io.");
      return;
    }
    let bounding_boxes: number[][][] | undefined;
    if (useCustomBoxes) {
      try {
        bounding_boxes = JSON.parse(customBoxesJson);
      } catch {
        setNewSourceFormError("Bounding boxes must be valid JSON.");
        return;
      }
    }
    createSourceMutation.mutate({
      name: newSourceName.trim(),
      adapter: newSourceAdapter,
      api_key: newSourceAdapter === "aisstream" ? newSourceApiKey.trim() : undefined,
      bounding_boxes,
    });
  }

  function handleRemoveSource(source: DataSource) {
    removeSourceMutation.mutate(source.id);
  }

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: sourcesApi.list,
    refetchInterval: 15_000,
  });
  const removeMutation = useMutation({
    mutationFn: ({ source, instance }: { source: string; instance: string }) =>
      sourcesApi.remove(source, instance),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  const retentionQuery = useQuery({ queryKey: ["retention-settings"], queryFn: retentionApi.get });
  const storageQuery = useQuery({
    queryKey: ["storage-stats"],
    queryFn: storageApi.get,
    refetchInterval: 30_000,
  });
  const updateRetentionMutation = useMutation({
    mutationFn: retentionApi.update,
    onSuccess: (data) => {
      queryClient.setQueryData(["retention-settings"], data);
      setSaveStatus("Saved.");
    },
    onError: () => setSaveStatus("Failed to save — try again."),
  });

  const [defaultHours, setDefaultHours] = useState("");
  const [watchlistedDays, setWatchlistedDays] = useState("");
  const [sweepInterval, setSweepInterval] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!retentionQuery.data) return;
    setDefaultHours(String(retentionQuery.data.default_hours));
    setWatchlistedDays(String(retentionQuery.data.watchlisted_days));
    setSweepInterval(String(retentionQuery.data.sweep_interval_seconds));
  }, [retentionQuery.data]);

  const sources = sourcesQuery.data ?? [];

  function handleRemove(source: string, instance: string) {
    removeMutation.mutate({ source, instance });
  }

  function handleSaveRetention() {
    const hours = Number(defaultHours);
    const days = Number(watchlistedDays);
    const interval = Number(sweepInterval);
    if (!Number.isFinite(hours) || !Number.isFinite(days) || !Number.isFinite(interval)) return;
    setSaveStatus(null);
    updateRetentionMutation.mutate({
      default_hours: hours,
      watchlisted_days: days,
      sweep_interval_seconds: interval,
    });
  }

  const smtpQuery = useQuery({ queryKey: ["smtp-settings"], queryFn: smtpSettingsApi.get });
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [smtpSaveStatus, setSmtpSaveStatus] = useState<string | null>(null);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailStatus, setTestEmailStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!smtpQuery.data) return;
    setSmtpHost(smtpQuery.data.host ?? "");
    setSmtpPort(String(smtpQuery.data.port));
    setSmtpUsername(smtpQuery.data.username ?? "");
    setSmtpFrom(smtpQuery.data.from_address ?? "");
    setSmtpUseTls(smtpQuery.data.use_tls);
  }, [smtpQuery.data]);

  const updateSmtpMutation = useMutation({
    mutationFn: smtpSettingsApi.update,
    onSuccess: (data) => {
      queryClient.setQueryData(["smtp-settings"], data);
      setSmtpPassword("");
      setSmtpSaveStatus("Saved.");
    },
    onError: () => setSmtpSaveStatus("Failed to save — try again."),
  });

  const testEmailMutation = useMutation({
    mutationFn: () => smtpSettingsApi.testEmail(testEmailTo.trim()),
    onSuccess: () => setTestEmailStatus("Sent — check the inbox."),
    onError: (err) =>
      setTestEmailStatus(err instanceof Error ? err.message : "Failed to send — check settings."),
  });

  function handleSaveSmtp() {
    const port = Number(smtpPort);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setSmtpSaveStatus("Port must be between 1 and 65535.");
      return;
    }
    setSmtpSaveStatus(null);
    updateSmtpMutation.mutate({
      host: smtpHost.trim() || null,
      port,
      username: smtpUsername.trim() || null,
      ...(smtpPassword.trim() ? { password: smtpPassword.trim() } : {}),
      from_address: smtpFrom.trim() || null,
      use_tls: smtpUseTls,
    });
  }

  return (
    <>
      <TopBar
        title="Admin"
        right={
          <button
            type="button"
            className={`sidebar-toggle${sidebarOpen ? " open" : ""}`}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? "✕ Close" : "☰ Sections"}
          </button>
        }
      />
      <div className="body">
        <aside className={`side${sidebarOpen ? " open" : ""}`} aria-label="Admin sections">
          <div className="ssect">
            <div className="eyebrow">Settings</div>
          </div>
          <a className="item" href="#data-sources" onClick={() => setSidebarOpen(false)}>
            <span>Data sources</span>
          </a>
          <a className="item" href="#sources" onClick={() => setSidebarOpen(false)}>
            <span>Sources &amp; health</span>
          </a>
          <a className="item" href="#retention" onClick={() => setSidebarOpen(false)}>
            <span>Retention &amp; storage</span>
          </a>
          <a className="item" href="#smtp" onClick={() => setSidebarOpen(false)}>
            <span>SMTP settings</span>
          </a>
        </aside>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14 }}>
          <div className="box" id="data-sources">
            <h2>Data sources</h2>
            <div className="bd">
              {!hasRealSource && (
                <p style={{ fontSize: 11.5, color: "var(--dim)", margin: "0 0 12px" }}>
                  You&apos;re only running the simulator right now — this instance is showing
                  fake, moving demo vessels, not real ships. To start tracking real AIS traffic:
                  1) sign up free at{" "}
                  <a href="https://aisstream.io" target="_blank" rel="noreferrer">
                    aisstream.io
                  </a>{" "}
                  and copy your API key, 2) paste it into the form below with adapter set to
                  &quot;AISStream&quot;, 3) add it. The worker picks it up within about{" "}
                  {WATCH_INTERVAL_LABEL} of a brief automatic restart.
                </p>
              )}
              <div style={{ overflow: "auto", marginBottom: 10 }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Adapter</th>
                      <th>API key</th>
                      <th>Enabled</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dataSources.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ color: "var(--faint)", textAlign: "center", padding: 20 }}>
                          No data sources configured yet.
                        </td>
                      </tr>
                    )}
                    {dataSources.map((s) => (
                      <tr key={s.id}>
                        <td data-label="Name">
                          <div className="name">{s.name}</div>
                        </td>
                        <td data-label="Adapter">{sourceLabel(s.adapter)}</td>
                        <td data-label="API key">
                          {s.adapter === "aisstream" ? (
                            <div style={{ display: "grid", gap: 4 }}>
                              <span className="mono" style={{ fontSize: 11 }}>
                                {s.api_key_preview ?? "not set"}
                              </span>
                              <DataSourceKeyUpdater source={s} disabled={demoMode} />
                            </div>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td data-label="Enabled">
                          <button
                            className="chip"
                            aria-pressed={s.enabled}
                            disabled={demoMode}
                            onClick={() =>
                              toggleSourceMutation.mutate({ id: s.id, enabled: !s.enabled })
                            }
                          >
                            {s.enabled ? "Enabled" : "Disabled"}
                          </button>
                        </td>
                        <td data-label="Actions">
                          <ConfirmButton
                            className="chip"
                            disabled={demoMode}
                            onConfirm={() => handleRemoveSource(s)}
                          >
                            Remove
                          </ConfirmButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 10 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Add a source
                </div>
                <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
                  <input
                    className="input"
                    placeholder="Name (e.g. Baltic AISStream)"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                  />
                  <select
                    className="input"
                    value={newSourceAdapter}
                    onChange={(e) => setNewSourceAdapter(e.target.value)}
                  >
                    {ADAPTER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {newSourceAdapter === "aisstream" && (
                    <>
                      <input
                        className="input mono"
                        type="password"
                        placeholder="AISStream API key"
                        value={newSourceApiKey}
                        onChange={(e) => setNewSourceApiKey(e.target.value)}
                      />
                      <span className="hint">
                        Free signup at{" "}
                        <a href="https://aisstream.io" target="_blank" rel="noreferrer">
                          aisstream.io
                        </a>
                        . Class A + Class B AIS traffic.
                      </span>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                        <input
                          type="checkbox"
                          checked={useCustomBoxes}
                          onChange={(e) => setUseCustomBoxes(e.target.checked)}
                        />
                        Custom coverage area (default: the whole Baltic Sea)
                      </label>
                      {useCustomBoxes && (
                        <textarea
                          className="input mono"
                          style={{ minHeight: 60, resize: "vertical" }}
                          value={customBoxesJson}
                          onChange={(e) => setCustomBoxesJson(e.target.value)}
                        />
                      )}
                    </>
                  )}
                  {newSourceFormError && (
                    <span style={{ color: "var(--stale)", fontSize: 11 }}>{newSourceFormError}</span>
                  )}
                  <div>
                    <button
                      className="btn pri sm"
                      onClick={handleAddSource}
                      disabled={demoMode || createSourceMutation.isPending}
                    >
                      Add source
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="box" id="sources" style={{ marginTop: 14 }}>
            <h2>
              Sources &amp; health
              <span
                className="mono"
                style={{ color: "var(--faint)", fontWeight: 400, marginLeft: "auto", fontSize: 11 }}
              >
                one row per adapter instance
              </span>
            </h2>
            <div style={{ overflow: "auto" }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Instance</th>
                    <th>State</th>
                    <th>Last message</th>
                    <th>Messages</th>
                    <th>Errors</th>
                    <th>Reconnects</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sources.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ color: "var(--faint)", textAlign: "center", padding: 20 }}>
                        No adapter has reported in yet.
                      </td>
                    </tr>
                  )}
                  {sources.map((s) => {
                    const down = isSourceDegraded(s.last_message_at);
                    return (
                      <tr key={`${s.source}-${s.instance}`}>
                        <td>
                          <div className="name">{sourceLabel(s.source)}</div>
                        </td>
                        <td className="mono num">{s.instance}</td>
                        <td title={s.error_summary ?? undefined}>
                          <span className={`fx ${down ? "delayed" : "live"}`}>
                            <i />
                            {down ? "Degraded" : "Up"}
                          </span>
                        </td>
                        <td className="num">
                          {s.last_message_at ? `${formatAgeForTime(s.last_message_at)} ago` : "never"}
                        </td>
                        <td className="num">{s.message_count}</td>
                        <td className="num" style={s.error_count > 0 ? { color: "var(--stale)" } : undefined}>
                          {s.error_count}
                        </td>
                        <td className="num">{s.reconnect_count}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <ConfirmButton
                            className="chip"
                            disabled={demoMode}
                            onConfirm={() => handleRemove(s.source, s.instance)}
                          >
                            Remove
                          </ConfirmButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ color: "var(--faint)", fontSize: 11, margin: "10px 0" }}>
            A row is one adapter instance's own reported health, not a live connection you can
            toggle from here — removing one only clears its history; a currently-running instance
            reappears on its next heartbeat.
          </p>

          <div className="box" id="retention" style={{ marginTop: 14 }}>
            <h2>Retention &amp; storage</h2>
            <div className="bd">
              <div className="row">
                <span className="lab">Non-watchlisted vessels</span>
                <span>
                  <input
                    className="input mono"
                    style={{ width: 70, textAlign: "right" }}
                    type="number"
                    min={1}
                    value={defaultHours}
                    onChange={(e) => setDefaultHours(e.target.value)}
                  />{" "}
                  hours
                </span>
                <span className="hint">
                  Position history for any vessel not on a watchlist is deleted after this long.
                </span>
              </div>
              <div className="row">
                <span className="lab">Watchlisted vessels</span>
                <span>
                  <input
                    className="input mono"
                    style={{ width: 70, textAlign: "right" }}
                    type="number"
                    min={1}
                    value={watchlistedDays}
                    onChange={(e) => setWatchlistedDays(e.target.value)}
                  />{" "}
                  days
                </span>
                <span className="hint">
                  A vessel on any watchlist keeps its position history this long instead.
                </span>
              </div>
              <div className="row">
                <span className="lab">Sweep interval</span>
                <span>
                  <input
                    className="input mono"
                    style={{ width: 70, textAlign: "right" }}
                    type="number"
                    min={60}
                    value={sweepInterval}
                    onChange={(e) => setSweepInterval(e.target.value)}
                  />{" "}
                  seconds
                </span>
                <span className="hint">
                  How often the ingest worker checks for and deletes expired rows.
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button
                  className="btn pri sm"
                  onClick={handleSaveRetention}
                  disabled={demoMode || updateRetentionMutation.isPending}
                >
                  Save
                </button>
                {saveStatus && (
                  <span style={{ fontSize: 11, color: "var(--faint)" }}>{saveStatus}</span>
                )}
                {retentionQuery.data && (
                  <span style={{ fontSize: 10.5, color: "var(--faint)", marginLeft: "auto" }}>
                    Last changed {formatAgeForTime(retentionQuery.data.updated_at)} ago. Takes
                    effect on the worker's next sweep, not instantly.
                  </span>
                )}
              </div>
            </div>

            <div className="bd" style={{ borderTop: "1px solid var(--line-soft)" }}>
              <div className="row">
                <span className="lab">Database size</span>
                <span className="mono">
                  {storageQuery.data ? formatBytes(storageQuery.data.database_size_bytes) : "…"}
                </span>
                <span className="hint">PostgreSQL 16 + PostGIS, whole database.</span>
              </div>
              <div style={{ overflow: "auto", marginTop: 6 }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Estimated rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(storageQuery.data?.tables ?? []).map((t) => (
                      <tr key={t.name}>
                        <td className="mono">{t.name}</td>
                        <td className="num">{formatCount(t.estimated_row_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 8 }}>
                Row counts are Postgres's own planner estimates, not exact — instant regardless of
                table size, at the cost of some drift right after a large insert or delete.
              </p>
            </div>
          </div>

          <div className="box" id="smtp" style={{ marginTop: 14 }}>
            <h2>SMTP settings</h2>
            <div className="bd">
              <p style={{ fontSize: 11.5, color: "var(--dim)", margin: "0 0 12px" }}>
                Used by alert rules with the Email channel turned on (Alerts → rule builder). Takes
                effect on the ingest worker's next delivery attempt, no restart needed.
              </p>
              <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
                <input
                  className="input"
                  placeholder="SMTP host"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input mono"
                    style={{ width: 90 }}
                    type="number"
                    placeholder="Port"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                    <input
                      type="checkbox"
                      checked={smtpUseTls}
                      onChange={(e) => setSmtpUseTls(e.target.checked)}
                    />
                    STARTTLS
                  </label>
                </div>
                <input
                  className="input"
                  placeholder="Username (optional)"
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                />
                <input
                  className="input mono"
                  type="password"
                  placeholder={smtpQuery.data?.has_password ? "Password set — leave blank to keep" : "Password"}
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="From address"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    className="btn pri sm"
                    onClick={handleSaveSmtp}
                    disabled={demoMode || updateSmtpMutation.isPending}
                  >
                    Save
                  </button>
                  {smtpSaveStatus && (
                    <span style={{ fontSize: 11, color: "var(--faint)" }}>{smtpSaveStatus}</span>
                  )}
                </div>
              </div>
              <div
                style={{
                  borderTop: "1px solid var(--line-soft)",
                  marginTop: 12,
                  paddingTop: 10,
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  maxWidth: 420,
                }}
              >
                <input
                  className="input"
                  placeholder="Send a test to…"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                />
                <button
                  className="btn sm"
                  disabled={demoMode || !testEmailTo.trim() || testEmailMutation.isPending}
                  onClick={() => {
                    setTestEmailStatus(null);
                    testEmailMutation.mutate();
                  }}
                >
                  {testEmailMutation.isPending ? "Sending…" : "Send test email"}
                </button>
              </div>
              {testEmailStatus && (
                <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{testEmailStatus}</span>
              )}
            </div>
          </div>

          <p style={{ color: "var(--faint)", fontSize: 11, marginTop: 10 }}>
            Backup &amp; restore and multi-user account settings aren't built yet.
          </p>
        </div>
      </div>
    </>
  );
}
