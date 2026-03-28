import { NavLink, Route, Routes } from "react-router-dom";
import StaffPage from "./pages/StaffPage.jsx";
import WeekShiftsPage from "./pages/WeekShiftsPage.jsx";
import RotaPage from "./pages/RotaPage.jsx";

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
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<StaffPage />} />
          <Route path="/shifts" element={<WeekShiftsPage />} />
          <Route path="/rota" element={<RotaPage />} />
        </Routes>
      </main>
    </div>
  );
}
