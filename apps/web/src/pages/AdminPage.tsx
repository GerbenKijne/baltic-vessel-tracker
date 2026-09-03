import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { retentionApi, storageApi } from "../api/retention";
import { sourcesApi } from "../api/sources";
import { TopBar } from "../components/TopBar";
import { formatAgeForTime } from "../freshness";
import { isSourceDegraded, sourceLabel } from "../sourceLabels";

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
  const queryClient = useQueryClient();

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
    if (confirm(`Remove ${sourceLabel(source)} instance "${instance}"?`)) {
      removeMutation.mutate({ source, instance });
    }
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

  return (
    <>
      <TopBar title="Admin" />
      <div className="body">
        <aside className="side" aria-label="Admin sections">
          <div className="ssect">
            <div className="eyebrow">Settings</div>
          </div>
          <a className="item" href="#sources">
            <span>Sources &amp; health</span>
          </a>
          <a className="item" href="#retention">
            <span>Retention &amp; storage</span>
          </a>
        </aside>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14 }}>
          <div className="box" id="sources">
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
                          <button className="chip" onClick={() => handleRemove(s.source, s.instance)}>
                            Remove
                          </button>
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
                  disabled={updateRetentionMutation.isPending}
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

          <p style={{ color: "var(--faint)", fontSize: 11, marginTop: 10 }}>
            Alert channels, backup &amp; restore, and account settings aren't built yet.
          </p>
        </div>
      </div>
    </>
  );
}
