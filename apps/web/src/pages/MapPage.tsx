import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useLiveVessels } from "../api/live";
import { watchlistsApi } from "../api/watchlists";
import { MapView } from "../components/MapView";
import { VesselLegend } from "../components/VesselLegend";

const DEFAULT_BBOX = { min_lon: 10, min_lat: 54, max_lon: 25, max_lat: 66 };

export function MapPage() {
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const { vessels, connected } = useLiveVessels(bbox);
  const queryClient = useQueryClient();

  const watchlistsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });

  const addToWatchlistMutation = useMutation({
    mutationFn: ({ mmsi, watchlistId }: { mmsi: string; watchlistId: string }) =>
      watchlistsApi.addVessel(watchlistId, mmsi),
    onSuccess: (_data, { watchlistId }) => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      queryClient.invalidateQueries({ queryKey: ["watchlists", watchlistId] });
    },
  });

  async function handleAddToWatchlist(mmsi: string, watchlistId: string) {
    await addToWatchlistMutation.mutateAsync({ mmsi, watchlistId });
  }

  async function handleCreateWatchlistAndAdd(mmsi: string, name: string) {
    const created = await watchlistsApi.create(name);
    queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    await addToWatchlistMutation.mutateAsync({ mmsi, watchlistId: created.id });
  }

  return (
    <div className="map-page">
      <MapView
        vessels={vessels}
        onMoveEnd={setBbox}
        watchlists={watchlistsQuery.data ?? []}
        onAddToWatchlist={handleAddToWatchlist}
        onCreateWatchlistAndAdd={handleCreateWatchlistAndAdd}
      />
      <VesselLegend connected={connected} vesselCount={vessels.size} />
    </div>
  );
}
