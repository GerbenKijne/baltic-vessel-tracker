import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useLiveVessels, type LiveVessel } from "../api/live";
import { sourcesApi } from "../api/sources";
import { watchlistsApi } from "../api/watchlists";
import { useTheme } from "../ThemeContext";
import { DegradationBanner } from "../components/DegradationBanner";
import { LegendPanel } from "../components/LegendPanel";
import { MapView, type MapMoveEnd } from "../components/MapView";
import { OnboardingBanner } from "../components/OnboardingBanner";
import { SearchPanel } from "../components/SearchPanel";
import { SourcePanel } from "../components/SourcePanel";
import { VesselDrawer } from "../components/VesselDrawer";
import { WatchlistPanel } from "../components/WatchlistPanel";
import type { Freshness } from "../freshness";
import { freshnessForTime } from "../freshness";
import { getMapViewMemory, saveMapViewMemory } from "../mapViewMemory";

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
  // MapPage/MapView fully unmount on route change (e.g. to History), so
  // plain useState would reset to defaults every time -- restore from
  // the last session's remembered viewport/filters instead, unless a
  // deep link (Watchlists' "View on map") says otherwise. mapViewMemory
  // is read once, here, since it's only meant to seed the initial state.
  const rememberedRef = useRef(getMapViewMemory());
  const remembered = rememberedRef.current;

  const [bbox, setBbox] = useState(remembered?.bbox ?? DEFAULT_BBOX);
  const { vessels: allVessels, connected } = useLiveVessels(bbox);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mobile only (see .map-panel-toggle/.map-panel-stack in styles.css) --
  // on desktop the panels are always visible in their own corners and
  // this state has no effect. Starts closed since even collapsed, the
  // five stacked panels are still too much to have permanently on
  // screen on a phone.
  const [panelsOpen, setPanelsOpen] = useState(false);

  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(
    searchParams.get("watchlist") ?? remembered?.selectedWatchlistId ?? null
  );
  const [freshnessFilter, setFreshnessFilter] = useState<Set<Freshness>>(
    new Set(remembered?.freshnessFilter ?? [])
  );
  const [watchlistOnly, setWatchlistOnly] = useState(remembered?.watchlistOnly ?? false);
  // Only an explicit click on a watchlist (handleSelectWatchlist) should
  // pan/zoom to fit it -- restoring a remembered selection on mount must
  // leave the just-restored viewport alone.
  const focusRequestedRef = useRef(false);
  // Not React state -- written on every moveend, read only when we need
  // to persist a snapshot alongside filter changes.
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(
    remembered ? { center: remembered.center, zoom: remembered.zoom } : null
  );

  // Deep-link param only sets initial state (from the Watchlists page's
  // "View on map" link); clear it so it doesn't re-fire.
  useEffect(() => {
    if (searchParams.has("watchlist")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMoveEnd(view: MapMoveEnd) {
    setBbox(view.bbox);
    cameraRef.current = { center: view.center, zoom: view.zoom };
  }

  // Persist a full snapshot whenever the viewport or any filter changes,
  // so the next mount (see rememberedRef above) picks up right where
  // this one left off.
  useEffect(() => {
    if (!cameraRef.current) return;
    saveMapViewMemory({
      center: cameraRef.current.center,
      zoom: cameraRef.current.zoom,
      bbox,
      selectedWatchlistId,
      watchlistOnly,
      freshnessFilter: Array.from(freshnessFilter),
    });
  }, [bbox, selectedWatchlistId, watchlistOnly, freshnessFilter]);

  const watchlistsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });
  const watchlistDetailQuery = useQuery({
    queryKey: ["watchlists", selectedWatchlistId],
    queryFn: () => watchlistsApi.get(selectedWatchlistId!),
    enabled: selectedWatchlistId !== null,
  });
  const memberMmsisQuery = useQuery({
    queryKey: ["watchlists", "member-mmsis"],
    queryFn: watchlistsApi.memberMmsis,
  });
  const watchlistedMmsis = useMemo(
    () => new Set(memberMmsisQuery.data ?? []),
    [memberMmsisQuery.data]
  );
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
    focusRequestedRef.current = true;
    setSelectedWatchlistId(id);
    // Picking a list defaults to showing only its members -- "show all,
    // but distinguish them" is an explicit opt-out via the checkbox, not
    // the default a fresh selection lands on.
    setWatchlistOnly(id !== null);
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
  // up instead of looking like they're missing. Only for an explicit
  // click (focusRequestedRef) -- never for a selection merely restored
  // from a remembered session, which should leave the viewport alone.
  const focusBounds = useMemo(() => {
    if (!selectedWatchlistId || !watchlistDetail || !focusRequestedRef.current) return null;
    focusRequestedRef.current = false;
    return boundsFromVessels(watchlistDetail.vessels);
  }, [selectedWatchlistId, watchlistDetail]);

  // Only meaningful when NOT already filtering the map down to just this
  // list (watchlistOnly already achieves that by hiding everything
  // else) -- lets "show all vessels" still make a list's members stand
  // out instead of blending in with everything else.
  const highlightMmsis = useMemo(() => {
    if (!selectedWatchlistId || watchlistOnly || !watchlistDetail) return null;
    return new Set(watchlistDetail.vessels.map((v) => v.mmsi));
  }, [selectedWatchlistId, watchlistOnly, watchlistDetail]);

  const selectedVessel = selectedMmsi ? allVessels.get(selectedMmsi) : undefined;

  return (
    <div className="map-page">
      <MapView
        vessels={vessels}
        onMoveEnd={handleMoveEnd}
        selectedMmsi={selectedMmsi}
        onSelectVessel={handleSelectVessel}
        focusBounds={focusBounds}
        theme={theme}
        initialCenter={remembered?.center}
        initialZoom={remembered?.zoom}
        highlightMmsis={highlightMmsis}
        watchlistedMmsis={watchlistedMmsis}
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
        <div className="float map-banners">
          <OnboardingBanner />
          <DegradationBanner sources={sourcesQuery.data ?? []} />
        </div>

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
          watchlistedMmsis={watchlistedMmsis}
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
          onShowHistory={(mmsi) => navigate(`/history?mmsi=${mmsi}`)}
          isWatchlisted={watchlistedMmsis.has(selectedVessel.mmsi)}
          watchlists={watchlistsQuery.data ?? []}
          onAddToWatchlist={handleAddToWatchlist}
          onCreateWatchlistAndAdd={handleCreateWatchlistAndAdd}
        />
      )}
    </div>
  );
}
