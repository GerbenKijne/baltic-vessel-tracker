import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { tracksApi } from "../api/tracks";
import { vesselsApi, type VesselSearchResult } from "../api/vessels";
import { TopBar } from "../components/TopBar";
import { TrackMapView, type HoverPointInfo } from "../components/TrackMapView";
import { formatAge } from "../freshness";
import { haversineNm } from "../geo";
import { useTheme } from "../ThemeContext";

type WindowMode = "24h" | "7d" | "custom";

function defaultCustomInput(offsetMs: number): string {
  const d = new Date(Date.now() - offsetMs);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function HistoryPage() {
  const { theme } = useTheme();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedVessel, setSelectedVessel] = useState<VesselSearchResult | null>(null);
  const [windowMode, setWindowMode] = useState<WindowMode>("24h");
  const [customFrom, setCustomFrom] = useState(() => defaultCustomInput(24 * 3600 * 1000));
  const [customTo, setCustomTo] = useState(() => defaultCustomInput(0));
  const [hoverInfo, setHoverInfo] = useState<HoverPointInfo | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["vessel-search", debouncedQuery],
    queryFn: () => vesselsApi.search(debouncedQuery),
    enabled: debouncedQuery.trim().length > 0,
  });

  const { from, to } = useMemo(() => {
    if (windowMode === "24h") return { from: new Date(Date.now() - 24 * 3600 * 1000), to: new Date() };
    if (windowMode === "7d") return { from: new Date(Date.now() - 7 * 24 * 3600 * 1000), to: new Date() };
    return { from: new Date(customFrom), to: new Date(customTo) };
  }, [windowMode, customFrom, customTo]);

  const validWindow = from.getTime() < to.getTime();

  const trackQuery = useQuery({
    queryKey: ["history-track", selectedVessel?.mmsi, from.toISOString(), to.toISOString()],
    queryFn: () => tracksApi.getRange(selectedVessel!.mmsi, from, to),
    enabled: selectedVessel !== null && validWindow,
  });
  const track = trackQuery.data;

  function handleSelectVessel(v: VesselSearchResult) {
    setSelectedVessel(v);
    setQuery("");
  }

  const stats = useMemo(() => {
    if (!track) return null;
    const allPoints = track.segments.flatMap((s) => s.points);
    const distanceNm = track.segments.reduce((sum, seg) => {
      let d = 0;
      for (let i = 1; i < seg.points.length; i++) {
        d += haversineNm(seg.points[i - 1], seg.points[i]);
      }
      return sum + d;
    }, 0);
    const sources = Array.from(new Set(allPoints.map((p) => p.source))).sort();
    return {
      pointCount: track.point_count,
      truncated: track.truncated,
      distanceNm,
      sources,
      gapCount: Math.max(0, track.segments.length - 1),
    };
  }, [track]);

  const gapRows = useMemo(() => {
    if (!track) return [];
    const rows: { from: Date; to: Date; durationMs: number; distanceNm: number }[] = [];
    for (let i = 0; i < track.segments.length - 1; i++) {
      const a = track.segments[i].points.at(-1);
      const b = track.segments[i + 1].points[0];
      if (!a || !b) continue;
      const fromDate = new Date(a.time);
      const toDate = new Date(b.time);
      rows.push({
        from: fromDate,
        to: toDate,
        durationMs: toDate.getTime() - fromDate.getTime(),
        distanceNm: haversineNm(a, b),
      });
    }
    return rows;
  }, [track]);

  const crumb = selectedVessel
    ? `${selectedVessel.name ?? "Unknown"} · ${selectedVessel.mmsi} · ${
        windowMode === "custom" ? "custom" : windowMode
      }`
    : undefined;

  return (
    <>
      <TopBar title="History" crumb={crumb} />
      <div className="body">
        <aside className="side" aria-label="Query">
          <div className="ssect">
            <label className="eyebrow" htmlFor="history-q">
              Vessel
            </label>
            <input
              id="history-q"
              className="input"
              placeholder="Name or MMSI"
              autoComplete="off"
              style={{ marginTop: 5 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {query.trim() && (
            <div className="history-search-results">
              {searchQuery.data && searchQuery.data.length > 0 ? (
                searchQuery.data.map((v) => (
                  <button key={v.mmsi} className="item" onClick={() => handleSelectVessel(v)}>
                    <span style={{ fontSize: 12 }}>{v.name ?? "Unknown"}</span>
                    <span className="n mono">{v.mmsi}</span>
                  </button>
                ))
              ) : (
                <div style={{ padding: "10px 13px", fontSize: 11, color: "var(--faint)" }}>
                  {searchQuery.isFetching ? "Searching…" : "No match."}
                </div>
              )}
            </div>
          )}

          {selectedVessel && !query.trim() && (
            <div
              className="ssect"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{selectedVessel.name ?? "Unknown"}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
                  {selectedVessel.mmsi}
                </div>
              </div>
              <button className="btn sm" onClick={() => setSelectedVessel(null)}>
                Change
              </button>
            </div>
          )}

          <div className="ssect" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Window
            </div>
            <div className="seg" style={{ width: "100%" }} role="group" aria-label="Time window">
              <button
                className={windowMode === "24h" ? "on" : undefined}
                style={{ flex: 1 }}
                onClick={() => setWindowMode("24h")}
              >
                24 h
              </button>
              <button
                className={windowMode === "7d" ? "on" : undefined}
                style={{ flex: 1 }}
                onClick={() => setWindowMode("7d")}
              >
                7 d
              </button>
              <button
                className={windowMode === "custom" ? "on" : undefined}
                style={{ flex: 1 }}
                onClick={() => setWindowMode("custom")}
              >
                Custom
              </button>
            </div>
            {windowMode === "custom" ? (
              <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
                <input
                  className="input"
                  type="datetime-local"
                  aria-label="From"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <input
                  className="input"
                  type="datetime-local"
                  aria-label="To"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
                {!validWindow && (
                  <span style={{ color: "var(--stale)", fontSize: 10.5 }}>From must be before to.</span>
                )}
              </div>
            ) : (
              <div className="history-window-range mono">
                {from.toLocaleString()} → {to.toLocaleString()}
              </div>
            )}
          </div>

          <div className="ssect">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Query result
            </div>
            <div style={{ display: "grid", gap: 4, fontSize: 11 }}>
              {!selectedVessel ? (
                <span style={{ color: "var(--faint)" }}>Select a vessel to query its track.</span>
              ) : trackQuery.isLoading ? (
                <span style={{ color: "var(--faint)" }}>Loading…</span>
              ) : trackQuery.isError ? (
                <span style={{ color: "var(--stale)" }}>
                  Couldn't load this track: {(trackQuery.error as Error).message}
                </span>
              ) : stats ? (
                <>
                  <div style={{ display: "flex" }}>
                    <span style={{ color: "var(--faint)" }}>Points{stats.truncated ? " (decimated)" : ""}</span>
                    <span className="mono" style={{ marginLeft: "auto" }}>
                      {stats.pointCount}
                    </span>
                  </div>
                  <div style={{ display: "flex" }}>
                    <span style={{ color: "var(--faint)" }}>Distance travelled</span>
                    <span className="mono" style={{ marginLeft: "auto" }}>
                      {stats.distanceNm.toFixed(1)} nm
                    </span>
                  </div>
                  <div style={{ display: "flex" }}>
                    <span style={{ color: "var(--faint)" }}>Coverage gaps</span>
                    <span className="mono" style={{ marginLeft: "auto" }}>
                      {stats.gapCount}
                    </span>
                  </div>
                  <div style={{ display: "flex" }}>
                    <span style={{ color: "var(--faint)" }}>Sources</span>
                    <span className="mono" style={{ marginLeft: "auto" }}>
                      {stats.sources.length > 0 ? stats.sources.join(", ") : "—"}
                    </span>
                  </div>
                </>
              ) : (
                <span style={{ color: "var(--faint)" }}>No observations in this window.</span>
              )}
            </div>
          </div>

          <div className="ssect">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Export
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              <button className="btn sm" disabled title="Not built yet">
                GeoJSON — LineString
              </button>
              <button className="btn sm" disabled title="Not built yet">
                CSV — observations
              </button>
            </div>
          </div>

          <div style={{ flex: 1 }} />
          <div
            className="ssect"
            style={{
              borderBottom: 0,
              borderTop: "1px solid var(--line-soft)",
              color: "var(--faint)",
              fontSize: 10.5,
            }}
          >
            Gaps are drawn, never bridged. A dashed segment means no accepted observation in that
            interval — not a straight-line passage.
          </div>
        </aside>

        <div className="history-body">
          {!selectedVessel ? (
            <div className="history-empty">Search for a vessel to review its track.</div>
          ) : (
            <>
              <div className="history-toolbar">
                <span className={trackQuery.isError ? "fx stale" : "fx live"}>
                  <i />
                  {trackQuery.isLoading
                    ? "Loading track…"
                    : trackQuery.isError
                      ? "Couldn't load this track"
                      : track
                        ? `Track drawn from ${track.point_count} accepted observation${
                            track.point_count === 1 ? "" : "s"
                          }${track.truncated ? " (decimated)" : ""}`
                        : "No data in this window"}
                </span>
                <div style={{ flex: 1 }} />
                <span className="chip" style={{ minWidth: 280, textAlign: "right" }}>
                  {hoverInfo
                    ? `${new Date(hoverInfo.time).toLocaleString()} · ${hoverInfo.lat.toFixed(4)}° N ${hoverInfo.lon.toFixed(4)}° E${
                        hoverInfo.sogKn != null ? ` · ${hoverInfo.sogKn.toFixed(1)} kn` : ""
                      } · ${hoverInfo.source}`
                    : "Hover the track for point detail"}
                </span>
              </div>
              <TrackMapView track={track ?? null} theme={theme} onHoverPoint={setHoverInfo} />
              {gapRows.length > 0 && (
                <div className="history-gaps">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Interval</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Duration</th>
                        <th>Straight-line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gapRows.map((g, i) => (
                        <tr key={i}>
                          <td className="num">Gap {i + 1}</td>
                          <td className="num">{g.from.toLocaleString()}</td>
                          <td className="num">{g.to.toLocaleString()}</td>
                          <td className="num">{formatAge(g.durationMs / 60_000)}</td>
                          <td className="num">{g.distanceNm.toFixed(1)} nm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="history-gaps-note">
                    Not for navigation. Positions may be delayed, incomplete, duplicated, spoofed, or
                    incorrect.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
