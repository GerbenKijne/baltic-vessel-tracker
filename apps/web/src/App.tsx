import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import { api } from "./api/client";
import { AdminPage } from "./pages/AdminPage";
import { AlertsPage } from "./pages/AlertsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { WatchlistsPage } from "./pages/WatchlistsPage";

const SECTIONS = [
  { to: "/map", code: "MA", label: "Map" },
  { to: "/watchlists", code: "WL", label: "Watchlists" },
  { to: "/alerts", code: "AL", label: "Alerts" },
  { to: "/history", code: "HI", label: "History" },
];

function AppShell({ onLogout, demoMode }: { onLogout: () => void; demoMode: boolean }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className={`app${demoMode ? " with-banner" : ""}`}>
      {demoMode && (
        <div className="demo-banner" role="status">
          Demo mode — read-only. Changes are disabled on this instance.
        </div>
      )}
      <nav className="nav" aria-label="Sections">
        <div className="brand mono">BVT</div>
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            title={s.label}
            aria-label={s.label}
            className={({ isActive }) => (isActive ? "on" : undefined)}
          >
            <span>{s.code}</span>
          </NavLink>
        ))}
        <div className="sp" />
        <NavLink
          to="/admin"
          title="Admin"
          aria-label="Admin"
          className={({ isActive }) => (isActive ? "on" : undefined)}
        >
          <span>AD</span>
        </NavLink>
        <button
          className="navlink"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
          onClick={toggleTheme}
        >
          <span>{theme === "dark" ? "☀" : "☾"}</span>
        </button>
        <button className="navlink" title="Sign out" aria-label="Sign out" onClick={onLogout}>
          <span>⏻</span>
        </button>
      </nav>
      <div className="main">
        <Routes>
          <Route path="/map" element={<MapPage />} />
          <Route path="/watchlists" element={<WatchlistsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/admin" element={<AdminPage />} />
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
    return <div className="loading-screen">Loading…</div>;
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

  return (
    <AuthProvider value={{ email: user.email, demoMode: user.demo_mode, logout: handleLogout }}>
      <AppShell onLogout={handleLogout} demoMode={user.demo_mode} />
    </AuthProvider>
  );
}
