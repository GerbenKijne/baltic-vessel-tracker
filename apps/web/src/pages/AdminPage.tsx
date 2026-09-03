import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sourcesApi } from "../api/sources";
import { TopBar } from "../components/TopBar";
import { formatAgeForTime } from "../freshness";
import { isSourceDegraded, sourceLabel } from "../sourceLabels";

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

  const sources = sourcesQuery.data ?? [];

  function handleRemove(source: string, instance: string) {
    if (confirm(`Remove ${sourceLabel(source)} instance "${instance}"?`)) {
      removeMutation.mutate({ source, instance });
    }
  }

  return (
    <>
      <TopBar title="Admin" />
      <div className="body">
        <aside className="side" aria-label="Admin sections">
          <div className="ssect">
            <div className="eyebrow">Settings</div>
          </div>
          <div className="item on">
            <span>Sources &amp; health</span>
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14 }}>
          <div className="box">
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
          <p style={{ color: "var(--faint)", fontSize: 11, marginTop: 10 }}>
            A row is one adapter instance's own reported health, not a live connection you can
            toggle from here — removing one only clears its history; a currently-running instance
            reappears on its next heartbeat. Retention/storage, alert channels, backup, and account
            settings aren't built yet.
          </p>
        </div>
      </div>
    </>
  );
}
