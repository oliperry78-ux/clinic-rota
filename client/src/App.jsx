import { NavLink, Route, Routes } from "react-router-dom";
import StaffPage from "./pages/StaffPage.jsx";
import WeekShiftsPage from "./pages/WeekShiftsPage.jsx";
import RotaPage from "./pages/RotaPage.jsx";
import DateAvailabilityPage from "./pages/DateAvailabilityPage.jsx";
import TempDateAvailabilityPage from "./pages/TempDateAvailabilityPage.jsx";
import HolidayRequestsPage from "./pages/HolidayRequestsPage.jsx";

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>Clinic staff rota</h1>
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
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<StaffPage />} />
          <Route path="/shifts" element={<WeekShiftsPage />} />
          <Route path="/rota" element={<RotaPage />} />
          <Route path="/date-availability" element={<DateAvailabilityPage />} />
          <Route path="/temp-date-availability/:staffId" element={<TempDateAvailabilityPage />} />
          <Route path="/holiday-requests" element={<HolidayRequestsPage />} />
        </Routes>
      </main>
    </div>
  );
}
