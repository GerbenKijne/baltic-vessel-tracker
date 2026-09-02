import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useLiveVessels, type LiveVessel } from "../api/live";
import { tracksApi } from "../api/tracks";
import { watchlistsApi } from "../api/watchlists";
import { MapView } from "../components/MapView";
import { VesselLegend } from "../components/VesselLegend";
import { WatchlistFilter } from "../components/WatchlistFilter";

const DEFAULT_BBOX = { min_lon: 10, min_lat: 54, max_lon: 25, max_lat: 66 };

function boundsFromVessels(vessels: { lon: number | null; lat: number | null }[]) {
  const points = vessels.filter(
    (v): v is { lon: number; lat: number } => v.lon != null && v.lat != null
  );
  if (points.length === 0) return null;
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ] as [[number, number], [number, number]];
}

export function MapPage() {
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const { vessels, connected } = useLiveVessels(bbox);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(
    searchParams.get("watchlist")
  );
  const [trackMmsi, setTrackMmsi] = useState<string | null>(searchParams.get("track"));

  // Deep-link params are only meant to set initial state (from the
  // Watchlists page's "View on map" / "Show track" links); clear them so
  // they don't linger and re-fire on every unrelated navigation.
  useEffect(() => {
    if (searchParams.has("watchlist") || searchParams.has("track")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchlistsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });
  const selectedWatchlistDetailQuery = useQuery({
    queryKey: ["watchlists", selectedWatchlistId],
    queryFn: () => watchlistsApi.get(selectedWatchlistId!),
    enabled: selectedWatchlistId !== null,
  });
  const trackQuery = useQuery({
    queryKey: ["track", trackMmsi],
    queryFn: () => tracksApi.get(trackMmsi!),
    enabled: trackMmsi !== null,
  });

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

  const watchlistDetail = selectedWatchlistDetailQuery.data;

  const filteredVessels = useMemo((): Map<string, LiveVessel> => {
    if (!selectedWatchlistId || !watchlistDetail) return vessels;
    const memberMmsis = new Set(watchlistDetail.vessels.map((v) => v.mmsi));
    const filtered = new Map<string, LiveVessel>();
    for (const [mmsi, vessel] of vessels) {
      if (memberMmsis.has(mmsi)) filtered.set(mmsi, vessel);
    }
    return filtered;
  }, [vessels, selectedWatchlistId, watchlistDetail]);

  // Widen the viewport to include every watchlisted vessel's last known
  // position when the filter is first applied, so vessels outside the
  // *current* bbox still show up rather than silently appearing empty.
  const focusBounds = useMemo(() => {
    if (!selectedWatchlistId || !watchlistDetail) return null;
    return boundsFromVessels(watchlistDetail.vessels);
  }, [selectedWatchlistId, watchlistDetail]);

  return (
    <div className="map-page">
      <MapView
        vessels={filteredVessels}
        onMoveEnd={setBbox}
        watchlists={watchlistsQuery.data ?? []}
        onAddToWatchlist={handleAddToWatchlist}
        onCreateWatchlistAndAdd={handleCreateWatchlistAndAdd}
        onShowTrack={setTrackMmsi}
        track={trackQuery.data ?? null}
        focusBounds={focusBounds}
      />
      <WatchlistFilter
        watchlists={watchlistsQuery.data ?? []}
        selectedId={selectedWatchlistId}
        onChange={setSelectedWatchlistId}
      />
      <VesselLegend connected={connected} vesselCount={filteredVessels.size} />
    </div>
  );
}
