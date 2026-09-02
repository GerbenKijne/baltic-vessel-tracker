import type { Watchlist } from "../api/watchlists";

interface Props {
  watchlists: Watchlist[];
  selectedId: string | null;
  onChange: (id: string | null) => void;
}

export function WatchlistFilter({ watchlists, selectedId, onChange }: Props) {
  return (
    <div className="watchlist-filter">
      <select
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Filter map by watchlist"
      >
        <option value="">All vessels</option>
        {watchlists.map((list) => (
          <option key={list.id} value={list.id}>
            {list.name} ({list.vessel_count})
          </option>
        ))}
      </select>
    </div>
  );
}
