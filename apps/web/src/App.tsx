import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { api } from "./api/client";
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { WatchlistsPage } from "./pages/WatchlistsPage";

function AppShell({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <NavLink to="/map">Map</NavLink>
        <NavLink to="/watchlists">Watchlists</NavLink>
        <NavLink to="/alerts">Alerts</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <button className="logout-button" onClick={onLogout}>
          Log out
        </button>
      </nav>
      <div className="app-content">
        <Routes>
          <Route path="/map" element={<MapPage />} />
          <Route path="/watchlists" element={<WatchlistsPage />} />
          <Route path="/alerts" element={<ComingSoonPage title="Alerts" />} />
          <Route path="/history" element={<ComingSoonPage title="History" />} />
          <Route path="/admin" element={<ComingSoonPage title="Admin" />} />
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });

  async function handleLogout() {
    await api.logout();
    queryClient.setQueryData(["me"], null);
  }

  if (isLoading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <LoginPage onLoggedIn={() => queryClient.invalidateQueries({ queryKey: ["me"] })} />
          }
        />
      </Routes>
    );
  }

  return <AppShell onLogout={handleLogout} />;
}
