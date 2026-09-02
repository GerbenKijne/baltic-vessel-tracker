interface Props {
  connected: boolean;
  vesselCount: number;
}

export function VesselLegend({ connected, vesselCount }: Props) {
  return (
    <div className="legend">
      <div className="legend-status">
        <span className={connected ? "dot dot-connected" : "dot dot-disconnected"} />
        {connected ? "Live" : "Reconnecting..."} · {vesselCount} vessels in view
      </div>
      <div className="legend-row">
        <span className="swatch swatch-live" /> Live (L) — ≤ 2 min
      </div>
      <div className="legend-row">
        <span className="swatch swatch-delayed" /> Delayed (D) — 2–15 min
      </div>
      <div className="legend-row">
        <span className="swatch swatch-stale" /> Stale (S) — &gt; 15 min
      </div>
      <p className="legend-disclaimer">
        Not for navigation. Data may be delayed, incomplete, duplicated, spoofed, or incorrect.
      </p>
    </div>
  );
}
