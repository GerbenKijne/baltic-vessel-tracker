import type { SourceStatus } from "../api/sources";
import { formatAgeForTime } from "../freshness";
import { isSourceDegraded, sourceLabel, sourceShort } from "../sourceLabels";

interface Props {
  sources: SourceStatus[];
}

export function SourcePanel({ sources }: Props) {
  const degraded = sources.filter((s) => isSourceDegraded(s.last_message_at));

  return (
    <details className="float map-source-panel">
      <summary className="map-source-summary">
        {sources.map((s) => (
          <span key={`${s.source}-${s.instance}`} className={`fx ${isSourceDegraded(s.last_message_at) ? "delayed" : "live"}`}>
            <i />
            {sourceShort(s.source)}
          </span>
        ))}
        <span style={{ marginLeft: "auto", color: "var(--faint)" }}>
          {degraded.length > 0 ? `${degraded.length} degraded ▾` : "all sources up ▾"}
        </span>
      </summary>
      <div style={{ padding: "2px 12px 11px" }}>
        {sources.length === 0 && (
          <div style={{ color: "var(--faint)", fontSize: 11, padding: "7px 0" }}>
            No adapter has reported in yet.
          </div>
        )}
        {sources.map((s) => {
          const down = isSourceDegraded(s.last_message_at);
          return (
            <div key={`${s.source}-${s.instance}`} className="map-source-row">
              <div className="name">{sourceLabel(s.source)}</div>
              <div>
                <span className={`fx ${down ? "delayed" : "live"}`}>
                  <i />
                  {down ? "Degraded" : "Up"}
                </span>
              </div>
              <div className="meta mono">
                {s.last_message_at ? `${formatAgeForTime(s.last_message_at)} ago` : "no messages yet"} ·{" "}
                {s.message_count} msgs · err {s.error_count} · reconnects {s.reconnect_count}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
