import { useMemo, useState } from "react";

import type { LiveVessel } from "../api/live";
import type { Freshness as FreshnessState } from "../freshness";
import { Freshness } from "./Freshness";

const FRESHNESS_FILTERS: FreshnessState[] = ["live", "delayed", "stale", "dark"];
const FRESHNESS_FILTER_LABEL: Record<FreshnessState, string> = {
  live: "Live only",
  delayed: "Delayed",
  stale: "Stale",
  dark: "Dark",
};

interface Props {
  vessels: Map<string, LiveVessel>;
  onSelectVessel: (mmsi: string) => void;
  freshnessFilter: Set<FreshnessState>;
  onToggleFreshnessFilter: (state: FreshnessState) => void;
  watchlistedMmsis: Set<string>;
}

export function SearchPanel({
  vessels,
  onSelectVessel,
  freshnessFilter,
  onToggleFreshnessFilter,
  watchlistedMmsis,
}: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return [];
    return Array.from(vessels.values())
      .filter((v) => (v.name ?? "").toLowerCase().includes(t) || v.mmsi.includes(t))
      .slice(0, 6);
  }, [vessels, query]);

  return (
    <div className="float map-search-panel">
      <input
        className="input"
        placeholder="Search name, MMSI, or IMO"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && (
        <div className="map-search-results">
          {results.length > 0 ? (
            results.map((v) => (
              <button
                key={v.mmsi}
                className="map-search-result"
                onClick={() => {
                  onSelectVessel(v.mmsi);
                  setQuery("");
                }}
              >
                <span className="name">
                  {watchlistedMmsis.has(v.mmsi) && (
                    <span style={{ color: "var(--delayed)" }} aria-label="On a watchlist">
                      ★{" "}
                    </span>
                  )}
                  {v.name ?? "Unknown"}
                </span>
                <span className="mono sub" style={{ marginLeft: 6 }}>
                  {v.mmsi}
                </span>
                <span style={{ float: "right" }}>
                  <Freshness time={v.observedAt ?? v.receivedAt} noWord />
                </span>
              </button>
            ))
          ) : (
            <div className="map-search-empty">No match in cached state.</div>
          )}
        </div>
      )}
      <div className="map-filter-row">
        <span
          className="chip"
          style={{ borderStyle: "dashed", background: "none" }}
          title="Vessel type isn't available from any connected source yet"
        >
          Type filters unavailable
        </span>
      </div>
      <div className="map-filter-row">
        {FRESHNESS_FILTERS.map((state) => (
          <button
            key={state}
            className="chip"
            aria-pressed={freshnessFilter.has(state)}
            onClick={() => onToggleFreshnessFilter(state)}
          >
            {FRESHNESS_FILTER_LABEL[state]}
          </button>
        ))}
        <span className="chip" style={{ borderStyle: "dashed", background: "none" }}>
          ★ Watchlist
        </span>
      </div>
    </div>
  );
}
