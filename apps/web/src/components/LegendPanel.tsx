import { useState } from "react";

import type { LiveVessel } from "../api/live";
import { freshnessForTime, FRESHNESS_LABEL, FRESHNESS_THRESHOLD_LABEL, type Freshness } from "../freshness";

// Open by default on desktop, where it's a small corner panel; collapsed
// on mobile, where the same content used to cover most of the screen.
// Computed once at mount (not reactive to resize) so a user's manual
// toggle afterward is never overridden.
function defaultOpen(): boolean {
  return typeof window === "undefined" || !window.matchMedia("(max-width: 680px)").matches;
}

const FRESHNESS_ORDER: Freshness[] = ["live", "delayed", "stale", "dark"];

function ShapeGlyph({ shape }: { shape: "arrow" | "square" | "circle" }) {
  const stroke = "var(--dim)";
  if (shape === "arrow") {
    return (
      <svg width="18" height="18" viewBox="-9 -9 18 18">
        <path d="M0 -8 L6 7 L0 4 L-6 7 Z" fill={stroke} />
      </svg>
    );
  }
  if (shape === "square") {
    return (
      <svg width="18" height="18" viewBox="-9 -9 18 18">
        <rect x="-5" y="-5" width="10" height="10" fill={stroke} />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="-9 -9 18 18">
      <circle r="5.5" fill="none" stroke={stroke} strokeWidth="1.6" />
      <circle r="1.4" fill={stroke} />
    </svg>
  );
}

interface Props {
  vessels: Map<string, LiveVessel>;
}

export function LegendPanel({ vessels }: Props) {
  const [open] = useState(defaultOpen);
  const counts: Record<Freshness, number> = { live: 0, delayed: 0, stale: 0, dark: 0 };
  for (const v of vessels.values()) {
    counts[freshnessForTime(v.observedAt ?? v.receivedAt)]++;
  }
  const total = vessels.size;

  return (
    <details className="float map-legend-panel" open={open}>
      <summary className="eyebrow" style={{ padding: "8px 12px" }}>
        Legend
      </summary>
      <div style={{ padding: "0 12px 12px" }}>
        <div className="map-legend-count mono">{total} vessels · viewport query</div>
        <div style={{ display: "grid", gap: 5 }}>
          {FRESHNESS_ORDER.map((state) => (
            <div key={state} className="map-legend-row">
              <span className={`fx ${state}`}>
                <i />
                {FRESHNESS_LABEL[state]}
              </span>
              <span className="mono thresh">
                {FRESHNESS_THRESHOLD_LABEL[state]} · {counts[state]}
              </span>
            </div>
          ))}
        </div>
        <div className="hr" style={{ margin: "9px 0" }} />
        <div className="map-legend-shapes">
          <div className="map-legend-shape-row">
            <span className="glyph">
              <ShapeGlyph shape="arrow" />
            </span>
            Under way — points to heading
          </div>
          <div className="map-legend-shape-row">
            <span className="glyph">
              <ShapeGlyph shape="square" />
            </span>
            Stopped or at anchor
          </div>
          <div className="map-legend-shape-row">
            <span className="glyph">
              <ShapeGlyph shape="circle" />
            </span>
            Orientation unknown
          </div>
        </div>
        <div className="map-legend-note">
          Colour carries freshness only — type is shown by filter, label and detail.
        </div>
      </div>
    </details>
  );
}
