import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { dataSourcesApi } from "../api/dataSources";

// Shown whenever nothing but the simulator is feeding this instance, so a
// new deployment's operator is pointed at Admin -> Data sources instead of
// wondering why the map only shows a handful of fake vessels circling
// Stockholm. Disappears on its own once a real source is enabled -- no
// manual dismiss needed, since the condition it describes resolves itself.
export function OnboardingBanner() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["data-sources"], queryFn: dataSourcesApi.list });

  if (!data) return null;
  const hasRealSource = data.some((s) => s.enabled && s.adapter !== "simulator");
  if (hasRealSource) return null;

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
      </div>
    </div>
  );
}
