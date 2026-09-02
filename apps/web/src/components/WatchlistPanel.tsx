import type { Watchlist, WatchlistDetail } from "../api/watchlists";
import { formatAgeForTime, freshnessForTime } from "../freshness";
import { Freshness } from "./Freshness";

interface Props {
  watchlists: Watchlist[];
  selectedId: string | null;
  onSelectList: (id: string | null) => void;
  detail: WatchlistDetail | undefined;
  onFocusVessel: (mmsi: string) => void;
  dimmed: boolean;
}

const FRESHNESS_RANK = { live: 0, delayed: 1, stale: 2, dark: 3 } as const;

export function WatchlistPanel({
  watchlists,
  selectedId,
  onSelectList,
  detail,
  onFocusVessel,
  dimmed,
}: Props) {
  const staleCount =
    detail?.vessels.filter((v) => v.freshness === "stale" || v.freshness === "dark").length ?? 0;

  const worstTime = detail?.vessels.reduce<string | null>((worst, v) => {
    const time = v.observed_at ?? v.received_at;
    if (!time) return worst;
    if (!worst) return time;
    const worstState = freshnessForTime(worst);
    const state = freshnessForTime(time);
    return FRESHNESS_RANK[state] > FRESHNESS_RANK[worstState] ? time : worst;
  }, null);

  return (
    <details
      className="float map-watchlist-panel"
      style={dimmed ? { opacity: 0.25, pointerEvents: "none" } : undefined}
    >
      <summary className="map-watchlist-summary">
        {worstTime && <Freshness time={worstTime} noWord />}
        <select
          className="name"
          value={selectedId ?? ""}
          onChange={(e) => onSelectList(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          style={{ background: "none", border: "none", color: "inherit", font: "inherit" }}
        >
          <option value="">Select a list…</option>
          {watchlists.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {detail && (
          <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>
            {detail.vessels.length} · {staleCount} stale
          </span>
        )}
        <span className="disclosure">▾</span>
      </summary>
      <div className="map-watchlist-body">
        {detail?.vessels
          .slice()
          .sort((a, b) => {
            const at = new Date(a.observed_at ?? a.received_at ?? 0).getTime();
            const bt = new Date(b.observed_at ?? b.received_at ?? 0).getTime();
            return bt - at;
          })
          .map((v) => (
            <button
              key={v.mmsi}
              className="vrow"
              onClick={() => onFocusVessel(v.mmsi)}
            >
              <div className="nm">{v.name ?? "Unknown"}</div>
              <div>
                {(v.observed_at ?? v.received_at) && (
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>
                    {formatAgeForTime(v.observed_at ?? v.received_at!)}
                  </span>
                )}
              </div>
              <div className="sub">
                <span>{v.mmsi}</span>
                <span style={{ marginLeft: "auto" }}>—</span>
              </div>
            </button>
          ))}
      </div>
    </details>
  );
}
