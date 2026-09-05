import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { dataSourcesApi } from "../api/dataSources";

const DISMISS_KEY = "bvt-dismiss-onboarding";

// Shown whenever nothing but the simulator is feeding this instance, so a
// new deployment's operator is pointed at Admin -> Data sources instead of
// wondering why the map only shows a handful of fake vessels circling
// Stockholm. Disappears on its own once a real source is enabled; until
// then it can also be dismissed for the tab's session, so it doesn't keep
// taxing the map's most valuable real estate on every visit.
export function OnboardingBanner() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["data-sources"], queryFn: dataSourcesApi.list });
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === "1");

  if (!data || dismissed) return null;
  const hasRealSource = data.some((s) => s.enabled && s.adapter !== "simulator");
  if (hasRealSource) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="map-banner">
      <div className="warnbar">
        <strong>Showing simulated data</strong>
        <span style={{ opacity: 0.9 }}>
          These are fake, moving demo vessels. Add a real AIS source to track actual ships.
        </span>
        <button
          className="btn sm"
          style={{ marginLeft: "auto", flex: "none" }}
          onClick={() => navigate("/admin#data-sources")}
        >
          Add a source →
        </button>
        <button
          className="btn sm"
          style={{ flex: "none" }}
          aria-label="Dismiss"
          title="Dismiss for this session"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
