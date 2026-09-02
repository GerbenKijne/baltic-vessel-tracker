import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { watchlistsApi } from "../api/watchlists";

function formatLastSeen(vessel: {
  observed_at: string | null;
  received_at: string | null;
  freshness: string | null;
}): string {
  if (!vessel.freshness) return "Never seen";
  const time = vessel.observed_at ?? vessel.received_at;
  return time ? new Date(time).toLocaleString() : "Unknown";
}

export function WatchlistsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [renameValue, setRenameValue] = useState<string | null>(null);

  const listsQuery = useQuery({ queryKey: ["watchlists"], queryFn: watchlistsApi.list });
  const detailQuery = useQuery({
    queryKey: ["watchlists", selectedId],
    queryFn: () => watchlistsApi.get(selectedId!),
    enabled: selectedId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => watchlistsApi.create(name),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setSelectedId(created.id);
      setNewListName("");
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => watchlistsApi.rename(selectedId!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setRenameValue(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => watchlistsApi.remove(selectedId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setSelectedId(null);
    },
  });

  const removeVesselMutation = useMutation({
    mutationFn: (mmsi: string) => watchlistsApi.removeVessel(selectedId!, mmsi),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });

  const lists = listsQuery.data ?? [];
  const detail = detailQuery.data;

  return (
    <div className="watchlists-page">
      <aside className="watchlists-sidebar">
        <h2>Watchlists</h2>
        <form
          className="watchlists-new-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newListName.trim()) createMutation.mutate(newListName.trim());
          }}
        >
          <input
            type="text"
            placeholder="New list name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
          />
          <button type="submit" disabled={!newListName.trim() || createMutation.isPending}>
            Add
          </button>
        </form>
        <ul className="watchlists-list">
          {lists.map((list) => (
            <li key={list.id}>
              <button
                className={list.id === selectedId ? "watchlist-item active" : "watchlist-item"}
                onClick={() => setSelectedId(list.id)}
              >
                <span>{list.name}</span>
                <span className="watchlist-count">{list.vessel_count}</span>
              </button>
            </li>
          ))}
          {lists.length === 0 && !listsQuery.isLoading && (
            <li className="watchlists-empty">No watchlists yet.</li>
          )}
        </ul>
      </aside>

      <main className="watchlists-main">
        {!selectedId && <p className="watchlists-placeholder">Select or create a watchlist.</p>}

        {selectedId && detail && (
          <>
            <div className="watchlists-header">
              {renameValue !== null ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renameValue.trim()) renameMutation.mutate(renameValue.trim());
                  }}
                >
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setRenameValue(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <h2>{detail.name}</h2>
                  <button onClick={() => setRenameValue(detail.name)}>Rename</button>
                  <button
                    className="watchlists-delete"
                    onClick={() => {
                      if (confirm(`Delete "${detail.name}"? This can't be undone.`)) {
                        deleteMutation.mutate();
                      }
                    }}
                  >
                    Delete list
                  </button>
                </>
              )}
            </div>

            {detail.vessels.length === 0 ? (
              <p className="watchlists-placeholder">
                No vessels in this list yet — add one from the map by clicking a vessel and
                choosing "Add to watchlist."
              </p>
            ) : (
              <table className="watchlists-table">
                <thead>
                  <tr>
                    <th>Vessel</th>
                    <th>MMSI</th>
                    <th>Freshness</th>
                    <th>Last seen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.vessels.map((vessel) => (
                    <tr key={vessel.mmsi}>
                      <td>{vessel.name ?? "Unknown"}</td>
                      <td>{vessel.mmsi}</td>
                      <td>
                        {vessel.freshness ? (
                          <span className={`swatch swatch-${vessel.freshness}`} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{formatLastSeen(vessel)}</td>
                      <td>
                        <button
                          className="watchlists-remove-vessel"
                          onClick={() => removeVesselMutation.mutate(vessel.mmsi)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </main>
    </div>
  );
}
