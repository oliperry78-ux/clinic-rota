import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BiweekAnchorBar } from "./BiweekAnchorContext.jsx";
import { useAuth } from "./AuthContext.jsx";
import { TempIsolationRedirect, useTempIsolation } from "./TempIsolationContext.jsx";
import StaffPage from "./pages/StaffPage.jsx";
import WeekShiftsPage from "./pages/WeekShiftsPage.jsx";
import RotaPage from "./pages/RotaPage.jsx";
import DateAvailabilityPage from "./pages/DateAvailabilityPage.jsx";
import TempDateAvailabilityPage from "./pages/TempDateAvailabilityPage.jsx";
import HolidayRequestsPage from "./pages/HolidayRequestsPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";

export default function App() {
  const location = useLocation();
  const { user, loading, signOut } = useAuth();
  const { lockedStaffId, tempV1LinkPending } = useTempIsolation();
  const hideManagerChrome = Boolean(lockedStaffId || tempV1LinkPending);
  const isTempPath = /\/temp-date-availability\/\d+\/?$/.test(location.pathname);
  // Auth pages must never render the internal app chrome (nav, BiweekAnchorBar, logout).
  // This covers all three standalone auth routes regardless of login state.
  const isAuthPath = ["/login", "/forgot-password", "/reset-password"].includes(
    location.pathname
  );

  // While Supabase restores the existing session from localStorage, show a neutral
  // loading screen so authenticated users don't see a flash of the login page.
  // Skip the loading screen on public/auth paths that must open immediately.
  if (loading && !isTempPath && !isAuthPath) {
    return (
      <div className="app">
        <header className="header">
          <h1>Clinic staff rota</h1>
        </header>
        <main className="main" style={{ textAlign: "center", paddingTop: "4rem" }}>
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <TempIsolationRedirect />
      <header className="header">
        <h1>Clinic staff rota</h1>
        {!hideManagerChrome && user && !isAuthPath ? (
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Staff
            </NavLink>
            <NavLink to="/shifts" className={({ isActive }) => (isActive ? "active" : "")}>
              Week shifts
            </NavLink>
            <NavLink to="/rota" className={({ isActive }) => (isActive ? "active" : "")}>
              Rota
            </NavLink>
            <NavLink to="/date-availability" className={({ isActive }) => (isActive ? "active" : "")}>
              Date availability
            </NavLink>
            <NavLink to="/holiday-requests" className={({ isActive }) => (isActive ? "active" : "")}>
              Holiday Requests
            </NavLink>
            <button
              onClick={() => signOut()}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: "var(--muted)",
                fontSize: "inherit",
                fontFamily: "inherit",
              }}
            >
              Log out
            </button>
          </nav>
        ) : null}
      </header>
      {!hideManagerChrome && user && !isAuthPath ? <BiweekAnchorBar /> : null}
      <main className="main">
        <Routes>
          {/* Public routes — accessible without authentication */}
          <Route
            path="/login"
            element={user ? <Navigate to="/" replace /> : <LoginPage />}
          />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          {/* Always public — must render even when a recovery session sets user */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/temp-date-availability/:staffId"
            element={<TempDateAvailabilityPage />}
          />

          {/* Protected routes — redirect to /login when not authenticated */}
          <Route
            path="/"
            element={user ? <StaffPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/shifts"
            element={user ? <WeekShiftsPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/rota"
            element={user ? <RotaPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/date-availability"
            element={user ? <DateAvailabilityPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/holiday-requests"
            element={user ? <HolidayRequestsPage /> : <Navigate to="/login" replace />}
          />
        </Routes>
      </main>
    </div>
  );
}
