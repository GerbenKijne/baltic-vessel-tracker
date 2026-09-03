import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useLiveVessels, type LiveVessel } from "../api/live";
import { sourcesApi } from "../api/sources";
import { tracksApi } from "../api/tracks";
import { watchlistsApi } from "../api/watchlists";
import { useTheme } from "../ThemeContext";
import { DegradationBanner } from "../components/DegradationBanner";
import { LegendPanel } from "../components/LegendPanel";
import { MapView } from "../components/MapView";
import { SearchPanel } from "../components/SearchPanel";
import { SourcePanel } from "../components/SourcePanel";
import { VesselDrawer } from "../components/VesselDrawer";
import { WatchlistPanel } from "../components/WatchlistPanel";
import type { Freshness } from "../freshness";
import { freshnessForTime } from "../freshness";

// Matches worker/config.py's DEFAULT_BOUNDING_BOXES: the whole Baltic Sea.
const DEFAULT_BBOX = { min_lon: 9, min_lat: 53.5, max_lon: 30.5, max_lat: 65.9 };

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
  const { theme } = useTheme();
  const [bbox, setBbox] = useState(DEFAULT_BBOX);
  const { vessels: allVessels, connected } = useLiveVessels(bbox);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mobile only (see .map-panel-toggle/.map-panel-stack in styles.css) --
  // on desktop the panels are always visible in their own corners and
  // this state has no effect. Starts closed since even collapsed, the
  // five stacked panels are still too much to have permanently on
  // screen on a phone.
  const [panelsOpen, setPanelsOpen] = useState(false);

  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(
    searchParams.get("watchlist")
  );
  const [trackMmsi, setTrackMmsi] = useState<string | null>(searchParams.get("track"));
  const [freshnessFilter, setFreshnessFilter] = useState<Set<Freshness>>(new Set());
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  // Deep-link params only set initial state (from the Watchlists page's
  // "View on map" / "Track" links); clear them so they don't re-fire.
  useEffect(() => {
    if (searchParams.has("watchlist") || searchParams.has("track")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchlistsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });
  const watchlistDetailQuery = useQuery({
    queryKey: ["watchlists", selectedWatchlistId],
    queryFn: () => watchlistsApi.get(selectedWatchlistId!),
    enabled: selectedWatchlistId !== null,
  });
  const trackQuery = useQuery({
    queryKey: ["track", trackMmsi],
    queryFn: () => tracksApi.get(trackMmsi!),
    enabled: trackMmsi !== null,
  });
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: sourcesApi.list,
    refetchInterval: 15_000,
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

  function handleSelectVessel(mmsi: string | null) {
    setSelectedMmsi(mmsi);
  }

  function toggleFreshnessFilter(state: Freshness) {
    setFreshnessFilter((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  }

  function handleSelectWatchlist(id: string | null) {
    setSelectedWatchlistId(id);
    if (!id) setWatchlistOnly(false);
  }

  const watchlistDetail = watchlistDetailQuery.data;

  const vessels = useMemo((): Map<string, LiveVessel> => {
    let result = allVessels;

    if (freshnessFilter.size > 0) {
      const filtered = new Map<string, LiveVessel>();
      for (const [mmsi, vessel] of result) {
        const state = freshnessForTime(vessel.observedAt ?? vessel.receivedAt);
        if (freshnessFilter.has(state)) filtered.set(mmsi, vessel);
      }
      result = filtered;
    }

    if (watchlistOnly && watchlistDetail) {
      const memberMmsis = new Set(watchlistDetail.vessels.map((v) => v.mmsi));
      const filtered = new Map<string, LiveVessel>();
      for (const [mmsi, vessel] of result) {
        if (memberMmsis.has(mmsi)) filtered.set(mmsi, vessel);
      }
      result = filtered;
    }

    return result;
  }, [allVessels, freshnessFilter, watchlistOnly, watchlistDetail]);

  // Widen the viewport to include every watchlisted vessel's last known
  // position when a list is selected, so out-of-view members actually show
  // up instead of looking like they're missing.
  const focusBounds = useMemo(() => {
    if (!selectedWatchlistId || !watchlistDetail) return null;
    return boundsFromVessels(watchlistDetail.vessels);
  }, [selectedWatchlistId, watchlistDetail]);

  const selectedVessel = selectedMmsi ? allVessels.get(selectedMmsi) : undefined;

  return (
    <div className="map-page">
      <MapView
        vessels={vessels}
        onMoveEnd={setBbox}
        selectedMmsi={selectedMmsi}
        onSelectVessel={handleSelectVessel}
        track={trackQuery.data ?? null}
        focusBounds={focusBounds}
        theme={theme}
      />

      <button
        type="button"
        className="float map-panel-toggle"
        onClick={() => setPanelsOpen((v) => !v)}
        aria-expanded={panelsOpen}
      >
        {panelsOpen ? "✕ Close" : "☰ Panels"}
      </button>

      <div className={`map-panel-stack${panelsOpen ? " open" : ""}`}>
        <DegradationBanner sources={sourcesQuery.data ?? []} />

        {!connected && (
          <div className="float map-reconnecting-banner">
            <span className="fx delayed">
              <i />
              Reconnecting…
            </span>
          </div>
        )}

        <SearchPanel
          vessels={vessels}
          onSelectVessel={handleSelectVessel}
          freshnessFilter={freshnessFilter}
          onToggleFreshnessFilter={toggleFreshnessFilter}
        />

        <WatchlistPanel
          watchlists={watchlistsQuery.data ?? []}
          selectedId={selectedWatchlistId}
          onSelectList={handleSelectWatchlist}
          detail={watchlistDetail}
          onFocusVessel={handleSelectVessel}
          dimmed={selectedMmsi !== null}
          watchlistOnly={watchlistOnly}
          onToggleWatchlistOnly={() => setWatchlistOnly((v) => !v)}
        />

        <SourcePanel sources={sourcesQuery.data ?? []} />

        <LegendPanel vessels={vessels} />
      </div>

      {selectedVessel && (
        <VesselDrawer
          vessel={selectedVessel}
          onClose={() => setSelectedMmsi(null)}
          onShowTrack={setTrackMmsi}
          watchlists={watchlistsQuery.data ?? []}
          onAddToWatchlist={handleAddToWatchlist}
          onCreateWatchlistAndAdd={handleCreateWatchlistAndAdd}
        />
      )}
    </div>
  );
}
