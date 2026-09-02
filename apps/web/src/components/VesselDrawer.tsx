import { useState } from "react";

import type { LiveVessel } from "../api/live";
import type { Watchlist } from "../api/watchlists";
import { sourceLabel } from "../sourceLabels";
import { Freshness } from "./Freshness";

// Our canonical quality flags (packages/contracts) don't match the design
// handoff's fictional vocabulary (no-heading, position-jump, etc.) --
// these describe what this codebase's adapters/normalizer actually emit.
const FLAG_DESCRIPTION: Record<string, string> = {
  stale_clock: "Provider clock disagrees with server time",
  invalid_position: "Position rejected as invalid",
  suspect_speed: "Speed value implausible",
  derived_time: "Observed time not provided by source; server receipt time used instead",
  conflict: "Conflicting reports from multiple sources",
};

function Unknown({ text = "Unknown" }: { text?: string }) {
  return <dd className="unk">{text}</dd>;
}

const NEW_LIST_VALUE = "__new__";

interface Props {
  vessel: LiveVessel;
  onClose: () => void;
  onShowTrack: (mmsi: string) => void;
  watchlists: Watchlist[];
  onAddToWatchlist: (mmsi: string, watchlistId: string) => Promise<void>;
  onCreateWatchlistAndAdd: (mmsi: string, name: string) => Promise<void>;
}

export function VesselDrawer({
  vessel,
  onClose,
  onShowTrack,
  watchlists,
  onAddToWatchlist,
  onCreateWatchlistAndAdd,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [selectedList, setSelectedList] = useState("");

  const lastSeenTime = vessel.observedAt ?? vessel.receivedAt;
  const receivedDeltaMs = vessel.observedAt
    ? new Date(vessel.receivedAt).getTime() - new Date(vessel.observedAt).getTime()
    : null;

  async function handleAdd() {
    if (!selectedList) return;
    setAddStatus("Adding…");
    try {
      if (selectedList === NEW_LIST_VALUE) {
        const name = window.prompt("New watchlist name:")?.trim();
        if (!name) {
          setAddStatus(null);
          return;
        }
        await onCreateWatchlistAndAdd(vessel.mmsi, name);
      } else {
        await onAddToWatchlist(vessel.mmsi, selectedList);
      }
      setAddStatus("Added.");
    } catch {
      setAddStatus("Failed to add — try again.");
    }
  }

  return (
    <aside className="drawer" aria-label="Vessel detail">
      <div className="dh">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Vessel</div>
            <div style={{ fontSize: 17, fontWeight: 600, margin: "2px 0 4px" }}>
              {vessel.name ?? "Unknown"}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Freshness time={lastSeenTime} showAge />
              <span className="tag">FLAG UNKNOWN</span>
            </div>
          </div>
          <button className="btn sm" aria-label="Close vessel detail" onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="btn pri sm" style={{ flex: 1 }} onClick={() => setAddOpen((v) => !v)}>
            ★ Add to watchlist
          </button>
          <button className="btn sm" onClick={() => onShowTrack(vessel.mmsi)}>
            History
          </button>
          <button className="btn sm" disabled title="Alerts aren't built yet">
            Rule
          </button>
        </div>
        {addOpen && (
          <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
            <select
              className="input"
              value={selectedList}
              onChange={(e) => setSelectedList(e.target.value)}
            >
              <option value="">Choose a list…</option>
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value={NEW_LIST_VALUE}>+ New list…</option>
            </select>
            <button className="btn sm" onClick={handleAdd} disabled={!selectedList}>
              Add
            </button>
          </div>
        )}
        {addStatus && (
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--faint)" }}>{addStatus}</div>
        )}
      </div>
      <div className="dbody">
        <div className="sect eyebrow" style={{ borderTop: 0 }}>
          Provenance
        </div>
        <dl className="kv">
          <dt>Source</dt>
          <dd>{sourceLabel(vessel.source)}</dd>
          <dt>Observed at</dt>
          {vessel.observedAt ? (
            <dd>{new Date(vessel.observedAt).toLocaleString()} UTC</dd>
          ) : (
            <Unknown text="Not reported by source" />
          )}
          <dt>Received at</dt>
          <dd>
            {receivedDeltaMs != null
              ? `+${(receivedDeltaMs / 1000).toFixed(1)} s server`
              : new Date(vessel.receivedAt).toLocaleString()}
          </dd>
          <dt>Also seen by</dt>
          <Unknown text="Single source" />
        </dl>
        {vessel.qualityFlags.length > 0 && (
          <div className="drawer-flags">
            {vessel.qualityFlags.map((flag) => (
              <div key={flag} className="drawer-flag">
                <span className="tag">{flag}</span>
                <span style={{ color: "var(--dim)", fontSize: 11 }}>
                  {FLAG_DESCRIPTION[flag] ?? ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="sect eyebrow">Identity</div>
        <dl className="kv">
          <dt>MMSI</dt>
          <dd>{vessel.mmsi}</dd>
          <dt>IMO</dt>
          <Unknown />
          <dt>Type</dt>
          <Unknown />
          <dt>LOA × beam</dt>
          <Unknown />
          <dt>Draught</dt>
          <Unknown />
        </dl>
        <div className="sect eyebrow">Voyage</div>
        <dl className="kv">
          <dt>Nav status</dt>
          {vessel.navStatus ? (
            <dd>{vessel.navStatus.replace(/_/g, " ")}</dd>
          ) : (
            <Unknown />
          )}
          <dt>Position</dt>
          <dd>
            {vessel.lat.toFixed(4)}° N
            <br />
            {vessel.lon.toFixed(4)}° E
          </dd>
          <dt>SOG</dt>
          {vessel.sogKn != null ? <dd>{vessel.sogKn.toFixed(1)} kn</dd> : <Unknown />}
          <dt>COG</dt>
          {vessel.cogDeg != null ? <dd>{vessel.cogDeg}°</dd> : <Unknown />}
          <dt>Heading</dt>
          {vessel.headingDeg != null ? <dd>{vessel.headingDeg}°</dd> : <Unknown />}
          <dt>Destination</dt>
          <Unknown text="Not reported" />
          <dt>ETA</dt>
          <Unknown text="Not reported" />
        </dl>
      </div>
    </aside>
  );
}
