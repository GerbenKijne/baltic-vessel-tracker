import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { tracksApi, type Track } from "../api/tracks";
import { vesselsApi, type VesselSearchResult } from "../api/vessels";
import { watchlistsApi } from "../api/watchlists";
import { TopBar } from "../components/TopBar";
import { TrackMapView, type HoverPointInfo, type VesselTrackEntry } from "../components/TrackMapView";
import { formatAge } from "../freshness";
import { haversineNm } from "../geo";
import { useTheme } from "../ThemeContext";
import { useBodyClassWhen } from "../useBodyClass";

type WindowMode = "24h" | "7d" | "custom";

// Cycled by selection order, not by MMSI, so re-adding a removed vessel
// doesn't necessarily get its old colour back -- simplest scheme that
// still gives every vessel on screen a distinct one for a handful of
// vessels at a time.
const PALETTE = ["#5ed6f6", "#f6c945", "#f68fd0", "#8fe388", "#f6935e", "#b28fe3", "#5ef6b0", "#f65e5e"];
function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length];
}

function defaultCustomInput(offsetMs: number): string {
  const d = new Date(Date.now() - offsetMs);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

function mergeVessels(
  existing: VesselSearchResult[],
  additions: VesselSearchResult[]
): VesselSearchResult[] {
  const seen = new Set(existing.map((v) => v.mmsi));
  const merged = [...existing];
  for (const v of additions) {
    if (!seen.has(v.mmsi)) {
      seen.add(v.mmsi);
      merged.push(v);
    }
  }
  return merged;
}

function stubVessel(mmsi: string): VesselSearchResult {
  return { mmsi, name: null, imo: null, last_observed_at: null, last_received_at: null };
}

export function HistoryPage() {
  const { theme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedVessels, setSelectedVessels] = useState<VesselSearchResult[]>([]);
  const [windowMode, setWindowMode] = useState<WindowMode>("24h");
  const [customFrom, setCustomFrom] = useState(() => defaultCustomInput(24 * 3600 * 1000));
  const [customTo, setCustomTo] = useState(() => defaultCustomInput(0));
  const [hoverInfo, setHoverInfo] = useState<HoverPointInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useBodyClassWhen("sheet-open", sidebarOpen);

  // Deep-link params (from the Map page's ship-card "History" button and
  // the Watchlists page's "View history" button) only seed the initial
  // selection; clear them so they don't re-fire on their own re-navigation.
  useEffect(() => {
    const mmsiParam = searchParams.get("mmsi");
    const watchlistParam = searchParams.get("watchlist");
    if (!mmsiParam && !watchlistParam) return;
    setSearchParams({}, { replace: true });

    if (watchlistParam) {
      watchlistsApi
        .get(watchlistParam)
        .then((detail) => {
          setSelectedVessels((prev) =>
            mergeVessels(
              prev,
              detail.vessels.map((v) => ({
                mmsi: v.mmsi,
                name: v.name,
                imo: null,
                last_observed_at: v.observed_at,
                last_received_at: v.received_at,
              }))
            )
          );
        })
        .catch(() => {
          // Watchlist may have been deleted since the link was made -- ignore.
        });
    }
    if (mmsiParam) {
      vesselsApi
        .search(mmsiParam)
        .then((results) => {
          const match = results.find((r) => r.mmsi === mmsiParam);
          setSelectedVessels((prev) => mergeVessels(prev, [match ?? stubVessel(mmsiParam)]));
        })
        .catch(() => {
          setSelectedVessels((prev) => mergeVessels(prev, [stubVessel(mmsiParam)]));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["vessel-search", debouncedQuery],
    queryFn: () => vesselsApi.search(debouncedQuery),
    enabled: debouncedQuery.trim().length > 0,
  });
  const memberMmsisQuery = useQuery({
    queryKey: ["watchlists", "member-mmsis"],
    queryFn: watchlistsApi.memberMmsis,
  });
  const watchlistedMmsis = useMemo(
    () => new Set(memberMmsisQuery.data ?? []),
    [memberMmsisQuery.data]
  );

  const { from, to } = useMemo(() => {
    if (windowMode === "24h") return { from: new Date(Date.now() - 24 * 3600 * 1000), to: new Date() };
    if (windowMode === "7d") return { from: new Date(Date.now() - 7 * 24 * 3600 * 1000), to: new Date() };
    return { from: new Date(customFrom), to: new Date(customTo) };
  }, [windowMode, customFrom, customTo]);

  const validWindow = from.getTime() < to.getTime();

  const trackResults = useQueries({
    queries: selectedVessels.map((v) => ({
      queryKey: ["history-track", v.mmsi, from.toISOString(), to.toISOString()],
      queryFn: () => tracksApi.getRange(v.mmsi, from, to),
      enabled: validWindow,
    })),
    // `useQueries` otherwise returns a brand-new array every render (even
    // when nothing changed) -- `combine` gets TanStack Query's structural
    // sharing, so the memos below don't recompute (and TrackMapView
    // doesn't re-fit its viewport) on a render caused by unrelated state
    // like the track map's own hover tooltip.
    combine: (results) => results,
  });

  function handleSelectVessel(v: VesselSearchResult) {
    setSelectedVessels((prev) => mergeVessels(prev, [v]));
    setQuery("");
  }

  function handleRemoveVessel(mmsi: string) {
    setSelectedVessels((prev) => prev.filter((v) => v.mmsi !== mmsi));
  }

  const entries: VesselTrackEntry[] = useMemo(
    () =>
      selectedVessels.map((v, i) => ({
        mmsi: v.mmsi,
        name: v.name,
        color: colorForIndex(i),
        track: trackResults[i]?.data ?? null,
      })),
    [selectedVessels, trackResults]
  );

  const vesselStats = useMemo(() => {
    return selectedVessels.map((v, i) => {
      const result = trackResults[i];
      const track: Track | undefined = result?.data;
      const color = colorForIndex(i);
      if (!track) {
        return {
          mmsi: v.mmsi,
          name: v.name,
          color,
          isLoading: result?.isLoading ?? false,
          error: result?.isError ? (result.error as Error).message : null,
          stats: null,
        };
      }
      const distanceNm = track.segments.reduce((sum, seg) => {
        let d = 0;
        for (let j = 1; j < seg.points.length; j++) d += haversineNm(seg.points[j - 1], seg.points[j]);
        return sum + d;
      }, 0);
      const sources = Array.from(new Set(track.segments.flatMap((s) => s.points.map((p) => p.source)))).sort();
      return {
        mmsi: v.mmsi,
        name: v.name,
        color,
        isLoading: false,
        error: null,
        stats: {
          pointCount: track.point_count,
          truncated: track.truncated,
          distanceNm,
          sources,
          gapCount: Math.max(0, track.segments.length - 1),
        },
      };
    });
  }, [selectedVessels, trackResults]);

  const gapRows = useMemo(() => {
    const rows: {
      mmsi: string;
      name: string | null;
      color: string;
      from: Date;
      to: Date;
      durationMs: number;
      distanceNm: number;
    }[] = [];
    selectedVessels.forEach((v, i) => {
      const track = trackResults[i]?.data;
      if (!track) return;
      const color = colorForIndex(i);
      for (let j = 0; j < track.segments.length - 1; j++) {
        const a = track.segments[j].points.at(-1);
        const b = track.segments[j + 1].points[0];
        if (!a || !b) continue;
        const fromDate = new Date(a.time);
        const toDate = new Date(b.time);
        rows.push({
          mmsi: v.mmsi,
          name: v.name,
          color,
          from: fromDate,
          to: toDate,
          durationMs: toDate.getTime() - fromDate.getTime(),
          distanceNm: haversineNm(a, b),
        });
      }
    });
    rows.sort((a, b) => a.from.getTime() - b.from.getTime());
    return rows;
  }, [selectedVessels, trackResults]);

  const anyLoading = trackResults.some((r) => r.isLoading);
  const totalPoints = vesselStats.reduce((sum, v) => sum + (v.stats?.pointCount ?? 0), 0);

  const crumb =
    selectedVessels.length === 1
      ? `${selectedVessels[0].name ?? "Unknown"} · ${selectedVessels[0].mmsi} · ${
          windowMode === "custom" ? "custom" : windowMode
        }`
      : selectedVessels.length > 1
        ? `${selectedVessels.length} vessels · ${windowMode === "custom" ? "custom" : windowMode}`
        : undefined;

  return (
    <>
      <TopBar
        title="History"
        crumb={crumb}
        right={
          <button
            type="button"
            className={`sidebar-toggle${sidebarOpen ? " open" : ""}`}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? "✕ Close" : "☰ Query"}
          </button>
        }
      />
      <div className="body">
        <aside className={`side${sidebarOpen ? " open" : ""}`} aria-label="Query">
          <div className="ssect">
            <label className="eyebrow" htmlFor="history-q">
              Add a vessel
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
                searchQuery.data.map((v) => {
                  const already = selectedVessels.some((s) => s.mmsi === v.mmsi);
                  return (
                    <button
                      key={v.mmsi}
                      className="item"
                      disabled={already}
                      onClick={() => handleSelectVessel(v)}
                    >
                      <span style={{ fontSize: 12 }}>
                        {watchlistedMmsis.has(v.mmsi) && (
                          <span style={{ color: "var(--delayed)" }} aria-label="On a watchlist">
                            ★{" "}
                          </span>
                        )}
                        {v.name ?? "Unknown"}
                      </span>
                      <span className="n mono">{already ? "Added" : v.mmsi}</span>
                    </button>
                  );
                })
              ) : (
                <div style={{ padding: "10px 13px", fontSize: 11, color: "var(--faint)" }}>
                  {searchQuery.isFetching ? "Searching…" : "No match."}
                </div>
              )}
            </div>
          )}

          {selectedVessels.length > 0 && (
            <div className="ssect" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="eyebrow">Selected vessels</div>
              {selectedVessels.map((v, i) => (
                <div key={v.mmsi} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: colorForIndex(i),
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 12.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {watchlistedMmsis.has(v.mmsi) && (
                        <span style={{ color: "var(--delayed)" }} aria-label="On a watchlist">
                          ★{" "}
                        </span>
                      )}
                      {v.name ?? "Unknown"}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
                      {v.mmsi}
                    </div>
                  </div>
                  <button
                    className="btn sm"
                    aria-label={`Remove ${v.name ?? v.mmsi}`}
                    onClick={() => handleRemoveVessel(v.mmsi)}
                  >
                    ✕
                  </button>
                </div>
              ))}
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
            {selectedVessels.length === 0 ? (
              <span style={{ color: "var(--faint)", fontSize: 11 }}>Add a vessel to query its track.</span>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {vesselStats.map((v) => (
                  <div key={v.mmsi} style={{ display: "grid", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: v.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{v.name ?? v.mmsi}</span>
                    </div>
                    {v.isLoading ? (
                      <span style={{ color: "var(--faint)", fontSize: 11 }}>Loading…</span>
                    ) : v.error ? (
                      <span style={{ color: "var(--stale)", fontSize: 11 }}>Couldn't load: {v.error}</span>
                    ) : v.stats ? (
                      <>
                        <div style={{ display: "flex", fontSize: 11 }}>
                          <span style={{ color: "var(--faint)" }}>
                            Points{v.stats.truncated ? " (decimated)" : ""}
                          </span>
                          <span className="mono" style={{ marginLeft: "auto" }}>
                            {v.stats.pointCount}
                          </span>
                        </div>
                        <div style={{ display: "flex", fontSize: 11 }}>
                          <span style={{ color: "var(--faint)" }}>Distance</span>
                          <span className="mono" style={{ marginLeft: "auto" }}>
                            {v.stats.distanceNm.toFixed(1)} nm
                          </span>
                        </div>
                        <div style={{ display: "flex", fontSize: 11 }}>
                          <span style={{ color: "var(--faint)" }}>Gaps</span>
                          <span className="mono" style={{ marginLeft: "auto" }}>
                            {v.stats.gapCount}
                          </span>
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "var(--faint)", fontSize: 11 }}>No observations in this window.</span>
                    )}
                  </div>
                ))}
              </div>
            )}
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
          {selectedVessels.length === 0 ? (
            <div className="history-empty">Add one or more vessels to review their tracks.</div>
          ) : (
            <>
              <div className="history-toolbar">
                <span className={vesselStats.some((v) => v.error) ? "fx stale" : "fx live"}>
                  <i />
                  {anyLoading
                    ? "Loading tracks…"
                    : `Tracks drawn from ${totalPoints} accepted observation${totalPoints === 1 ? "" : "s"} across ${
                        selectedVessels.length
                      } vessel${selectedVessels.length === 1 ? "" : "s"}`}
                </span>
                <div style={{ flex: 1 }} />
                <span className="chip" style={{ minWidth: 300, textAlign: "right" }}>
                  {hoverInfo ? (
                    <>
                      <span style={{ color: hoverInfo.color, fontWeight: 600 }}>
                        {hoverInfo.name ?? hoverInfo.mmsi}
                      </span>{" "}
                      · {new Date(hoverInfo.time).toLocaleString()} · {hoverInfo.lat.toFixed(4)}° N{" "}
                      {hoverInfo.lon.toFixed(4)}° E
                      {hoverInfo.sogKn != null ? ` · ${hoverInfo.sogKn.toFixed(1)} kn` : ""} · {hoverInfo.source}
                    </>
                  ) : (
                    "Hover the track for point detail"
                  )}
                </span>
              </div>
              <TrackMapView entries={entries} theme={theme} onHoverPoint={setHoverInfo} />
              {gapRows.length > 0 && (
                <div className="history-gaps">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Vessel</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Duration</th>
                        <th>Straight-line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gapRows.map((g, i) => (
                        <tr key={i}>
                          <td className="num" style={{ color: g.color }}>
                            {g.name ?? g.mmsi}
                          </td>
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
