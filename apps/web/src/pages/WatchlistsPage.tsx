import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { watchlistsApi, type WatchlistVessel } from "../api/watchlists";
import { Freshness } from "../components/Freshness";
import { TopBar } from "../components/TopBar";
import { downloadTextFile, parseWatchlistCsv, vesselsToCsv, vesselsToGeoJson } from "../exportUtils";
import { freshnessForTime, FRESHNESS_LABEL, type Freshness as FreshnessState } from "../freshness";

function FreshnessDot({ state }: { state: FreshnessState }) {
  return (
    <span className={`fx ${state}`}>
      <i />
      {FRESHNESS_LABEL[state]}
    </span>
  );
}

type SortMode = "seen" | "name";
type ViewMode = "table" | "cards";

function formatNavStatus(navStatus: string | null): string {
  if (!navStatus) return "Unknown";
  const spaced = navStatus.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Unknown({ text = "Unknown" }: { text?: string }) {
  return <span className="unk">{text}</span>;
}

function VesselTableRow({ vessel, onRemove }: { vessel: WatchlistVessel; onRemove: () => void }) {
  const lastSeenTime = vessel.observed_at ?? vessel.received_at;
  return (
    <tr>
      <td style={{ color: "var(--delayed)" }} aria-label="Starred">
        ★
      </td>
      <td>
        <div className="name">{vessel.name ?? "Unknown"}</div>
        <div className="sub mono">{vessel.mmsi}{vessel.imo ? ` · IMO ${vessel.imo}` : " · no IMO"}</div>
      </td>
      <td>{lastSeenTime ? <Freshness time={lastSeenTime} showAge /> : <Unknown text="Never seen" />}</td>
      <td className="num" style={{ color: "var(--dim)" }}>
        Unknown
      </td>
      <td className="num">
        {vessel.sog_kn != null ? `${vessel.sog_kn.toFixed(1)} kn` : <Unknown />}
        <div className="sub mono">
          {vessel.cog_deg != null ? `COG ${vessel.cog_deg.toFixed(0)}°` : "COG unknown"}
          {vessel.heading_deg != null ? ` · HDG ${vessel.heading_deg}°` : ""}
        </div>
      </td>
      <td>
        {vessel.destination ?? <Unknown text="Not reported" />}
      </td>
      <td style={{ maxWidth: 150 }}>{formatNavStatus(vessel.nav_status)}</td>
      <td>{vessel.ship_type ?? "Unknown"}</td>
      <td>
        <span className="sub">—</span>
      </td>
      <td>
        <button className="chip" onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  );
}

function VesselCard({ vessel, onRemove }: { vessel: WatchlistVessel; onRemove: () => void }) {
  const lastSeenTime = vessel.observed_at ?? vessel.received_at;
  return (
    <div className="card">
      <div className="watchlists-card-header">
        <div className="name" style={{ fontSize: 13 }}>
          {vessel.name ?? "Unknown"}
        </div>
        <div style={{ marginLeft: "auto" }}>
          {lastSeenTime && <Freshness time={lastSeenTime} noWord showAge />}
        </div>
      </div>
      <div className="sub watchlists-card-sub">{vessel.mmsi} · {vessel.ship_type ?? "Unknown"}</div>
      <div className="hr" style={{ margin: "9px -12px" }} />
      <div className="watchlists-card-grid">
        <div>
          <div className="eyebrow">Speed</div>
          <div className="mono">{vessel.sog_kn != null ? `${vessel.sog_kn.toFixed(1)} kn` : "—"}</div>
        </div>
        <div>
          <div className="eyebrow">Course</div>
          <div className="mono">{vessel.cog_deg != null ? `${vessel.cog_deg}°` : "—"}</div>
        </div>
        <div>
          <div className="eyebrow">Destination</div>
          <div className="mono">{vessel.destination ?? "—"}</div>
        </div>
        <div>
          <div className="eyebrow">Source</div>
          <div className="mono">—</div>
        </div>
      </div>
      <div className="watchlists-card-flags">
        {vessel.quality_flags.map((flag) => (
          <span key={flag} className="chip" style={{ color: "var(--delayed)", borderColor: "oklch(0.46 0.09 78)" }}>
            {flag}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 9 }}>
        <button className="chip" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

export function WatchlistsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState<SortMode>("seen");
  const [staleOnly, setStaleOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("table");

  const listsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });
  const detailQuery = useQuery({
    queryKey: ["watchlists", selectedId],
    queryFn: () => watchlistsApi.get(selectedId!),
    enabled: selectedId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => watchlistsApi.create(name),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setSelectedId(created.id);
      setNewListName("");
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => watchlistsApi.rename(selectedId!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setRenameValue(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => watchlistsApi.remove(selectedId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setSelectedId(null);
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleImportFile(file: File) {
    if (!selectedId) return;
    const text = await file.text();
    const rows = parseWatchlistCsv(text);
    if (rows.length === 0) {
      setImportStatus("No rows with an MMSI found in that file.");
      return;
    }
    setImporting(true);
    setImportStatus(null);
    let added = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await watchlistsApi.addVessel(selectedId, row.mmsi, row.note);
        added++;
      } catch {
        failed++;
      }
    }
    setImporting(false);
    setImportStatus(
      `Imported ${added} of ${rows.length}${failed > 0 ? ` (${failed} failed — unknown MMSI or already on the list)` : ""}.`
    );
    queryClient.invalidateQueries({ queryKey: ["watchlists", selectedId] });
    queryClient.invalidateQueries({ queryKey: ["watchlists"] });
  }

  function handleExportCsv() {
    if (!detailQuery.data) return;
    downloadTextFile(
      `${detailQuery.data.name.replace(/[^a-z0-9]+/gi, "-")}.csv`,
      vesselsToCsv(detailQuery.data.vessels),
      "text/csv"
    );
  }

  function handleExportGeoJson() {
    if (!detailQuery.data) return;
    downloadTextFile(
      `${detailQuery.data.name.replace(/[^a-z0-9]+/gi, "-")}.geojson`,
      JSON.stringify(vesselsToGeoJson(detailQuery.data.vessels), null, 2),
      "application/geo+json"
    );
  }

  const removeVesselMutation = useMutation({
    mutationFn: (mmsi: string) => watchlistsApi.removeVessel(selectedId!, mmsi),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });

  const lists = listsQuery.data ?? [];
  const detail = detailQuery.data;

  const rows = useMemo(() => {
    if (!detail) return [];
    let l = detail.vessels.filter((v) => {
      if (staleOnly) {
        const time = v.observed_at ?? v.received_at;
        const state = time ? freshnessForTime(time) : "dark";
        if (state !== "stale" && state !== "dark") return false;
      }
      if (!filterText) return true;
      const t = filterText.toLowerCase();
      return (v.name ?? "").toLowerCase().includes(t) || v.mmsi.includes(t);
    });
    l = l.slice();
    if (sort === "seen") {
      l.sort((a, b) => {
        const at = new Date(a.observed_at ?? a.received_at ?? 0).getTime();
        const bt = new Date(b.observed_at ?? b.received_at ?? 0).getTime();
        return bt - at;
      });
    } else {
      l.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    }
    return l;
  }, [detail, filterText, sort, staleOnly]);

  const rollup = useMemo(() => {
    const counts: Record<string, number> = { live: 0, delayed: 0, stale: 0, dark: 0 };
    for (const v of detail?.vessels ?? []) {
      const time = v.observed_at ?? v.received_at;
      const state = time ? freshnessForTime(time) : "dark";
      counts[state]++;
    }
    return counts;
  }, [detail]);

  return (
    <>
      <TopBar
        title="Watchlists"
        crumb={detail?.name}
        right={
          <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>
            no application cap
          </span>
        }
      />
      <div className="body">
        <aside className="side" aria-label="Lists">
          <div className="ssect">
            <div className="eyebrow">Lists</div>
          </div>
          {lists.map((list) => (
            <button
              key={list.id}
              className={list.id === selectedId ? "item on" : "item"}
              onClick={() => setSelectedId(list.id)}
            >
              <span>{list.name}</span>
              <span className="n">{list.vessel_count}</span>
            </button>
          ))}
          {lists.length === 0 && !listsQuery.isLoading && (
            <div className="ssect" style={{ color: "var(--faint)", fontSize: 11 }}>
              No watchlists yet.
            </div>
          )}
          <div className="ssect" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newListName.trim()) createMutation.mutate(newListName.trim());
              }}
              style={{ display: "flex", gap: 5 }}
            >
              <input
                className="input"
                placeholder="New list name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
              />
              <button className="btn sm" type="submit" disabled={!newListName.trim()}>
                Add
              </button>
            </form>
          </div>
          <div className="ssect">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Bulk
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file);
                  e.target.value = "";
                }}
              />
              <button
                className="btn sm"
                disabled={!selectedId || importing}
                title={selectedId ? undefined : "Select a list first"}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? "Importing…" : "Import CSV…"}
              </button>
              <button
                className="btn sm"
                disabled={!detailQuery.data}
                title={detailQuery.data ? undefined : "Select a list first"}
                onClick={handleExportCsv}
              >
                Export CSV
              </button>
              <button
                className="btn sm"
                disabled={!detailQuery.data}
                title={detailQuery.data ? undefined : "Select a list first"}
                onClick={handleExportGeoJson}
              >
                Export GeoJSON
              </button>
            </div>
            {importStatus && (
              <div className="watchlists-bulk-note" style={{ color: "var(--dim)" }}>
                {importStatus}
              </div>
            )}
            <div className="watchlists-bulk-note">
              CSV takes MMSI, optional note. Duplicates within a list are rejected, not merged.
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {detail && (
            <div className="ssect" style={{ borderBottom: 0, borderTop: "1px solid var(--line-soft)" }}>
              <div className="eyebrow" style={{ marginBottom: 5 }}>
                This list
              </div>
              <div className="watchlists-rollup">
                {(["live", "delayed", "stale", "dark"] as const).map((k) => (
                  <div key={k} className="watchlists-rollup-row">
                    <FreshnessDot state={k} />
                    <span className="mono">{rollup[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {!selectedId && (
          <div className="wrap">
            <p className="watchlists-empty-state">Select or create a watchlist.</p>
          </div>
        )}

        {selectedId && detail && (
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="toolbar">
              {renameValue !== null ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renameValue.trim()) renameMutation.mutate(renameValue.trim());
                  }}
                  style={{ display: "flex", gap: 5 }}
                >
                  <input
                    className="input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                  />
                  <button className="btn sm" type="submit">
                    Save
                  </button>
                  <button className="btn sm" type="button" onClick={() => setRenameValue(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <input
                    className="input"
                    placeholder="Filter this list"
                    style={{ maxWidth: 220 }}
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                  />
                  <div className="seg" role="group" aria-label="Sort">
                    <button className={sort === "seen" ? "on" : undefined} onClick={() => setSort("seen")}>
                      ↓ last seen
                    </button>
                    <button className={sort === "name" ? "on" : undefined} onClick={() => setSort("name")}>
                      A–Z
                    </button>
                  </div>
                  <button
                    className="chip"
                    aria-pressed={staleOnly}
                    onClick={() => setStaleOnly((v) => !v)}
                  >
                    Stale &amp; dark only
                  </button>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>
                    {rows.length} shown
                  </span>
                  <div className="seg" role="group" aria-label="View mode">
                    <button className={view === "table" ? "on" : undefined} onClick={() => setView("table")}>
                      Table
                    </button>
                    <button className={view === "cards" ? "on" : undefined} onClick={() => setView("cards")}>
                      Cards
                    </button>
                  </div>
                  <button className="btn sm" onClick={() => setRenameValue(detail.name)}>
                    Rename
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => {
                      if (confirm(`Delete "${detail.name}"? This can't be undone.`)) {
                        deleteMutation.mutate();
                      }
                    }}
                  >
                    Delete list
                  </button>
                  <button className="btn sm" onClick={() => navigate(`/map?watchlist=${detail.id}`)}>
                    View on map
                  </button>
                  <button className="btn sm" onClick={() => navigate(`/history?watchlist=${detail.id}`)}>
                    View history
                  </button>
                </>
              )}
            </div>

            <div className="wrap">
              {rows.length === 0 ? (
                <p className="watchlists-empty-state">
                  {detail.vessels.length === 0
                    ? 'No vessels in this list yet — add one from the map by clicking a vessel and choosing "Add to watchlist."'
                    : "No vessels match."}
                </p>
              ) : view === "table" ? (
                <table className="t">
                  <thead>
                    <tr>
                      <th style={{ width: 26 }}>★</th>
                      <th>Vessel</th>
                      <th>Last seen</th>
                      <th>Source</th>
                      <th>Speed / course</th>
                      <th>Destination &amp; ETA</th>
                      <th>Nav status</th>
                      <th>Type &amp; flag</th>
                      <th>Rules</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((vessel) => (
                      <VesselTableRow
                        key={vessel.mmsi}
                        vessel={vessel}
                        onRemove={() => removeVesselMutation.mutate(vessel.mmsi)}
                      />
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="cards">
                  {rows.map((vessel) => (
                    <VesselCard
                      key={vessel.mmsi}
                      vessel={vessel}
                      onRemove={() => removeVesselMutation.mutate(vessel.mmsi)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="watchlists-footer">
              <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>
                {rows.length} of {detail.vessels.length} shown
              </span>
              <div style={{ flex: 1 }} />
              {rollup.stale + rollup.dark > 0 && (
                <span className="fx delayed">
                  <i />
                  {rollup.stale + rollup.dark} vessel{rollup.stale + rollup.dark === 1 ? "" : "s"} stale
                  or dark
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
