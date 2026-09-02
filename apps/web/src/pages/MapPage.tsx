import { useState } from "react";

import { useLiveVessels } from "../api/live";
import { MapView } from "../components/MapView";
import { VesselLegend } from "../components/VesselLegend";

const DEFAULT_BBOX = { min_lon: 10, min_lat: 54, max_lon: 25, max_lat: 66 };

export function MapPage() {
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const { vessels, connected } = useLiveVessels(bbox);

  return (
    <div className="map-page">
      <MapView vessels={vessels} onMoveEnd={setBbox} />
      <VesselLegend connected={connected} vesselCount={vessels.size} />
    </div>
  );
}
