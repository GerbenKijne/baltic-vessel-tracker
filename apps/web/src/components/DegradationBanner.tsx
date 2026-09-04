import { useState } from "react";

import type { SourceStatus } from "../api/sources";
import { formatAgeForTime } from "../freshness";
import { isSourceDegraded, sourceLabel } from "../sourceLabels";

interface Props {
  sources: SourceStatus[];
}

export function DegradationBanner({ sources }: Props) {
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const degraded = sources.filter((s) => isSourceDegraded(s.last_message_at));
  const worst = degraded[0];

  if (!worst || dismissedFor === worst.source) return null;

  const since = worst.last_message_at ? `${formatAgeForTime(worst.last_message_at)} since last message.` : "No message received yet.";

  return (
    <div className="map-banner">
      <div className="warnbar">
        <strong>{sourceLabel(worst.source)} degraded</strong>
        <span style={{ opacity: 0.9 }}>{since} Coverage may be reduced.</span>
        <button className="btn sm" style={{ marginLeft: "auto", flex: "none" }} onClick={() => setDismissedFor(worst.source)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
