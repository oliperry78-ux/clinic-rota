import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { toISODate } from "../dates.js";

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function buildMonthCells(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let lead = first.getDay();
  lead = lead === 0 ? 6 : lead - 1;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toISODate(new Date(year, monthIndex, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function HolidayRequestsPage() {
  const [staff, setStaff] = useState([]);
  const [dateOverrides, setDateOverrides] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [localReds, setLocalReds] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const [sList, ov] = await Promise.all([api.getStaff(), api.getDateOverrides()]);
      setStaff(sList);
      setDateOverrides(ov?.dateOverrides ?? []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setLocalReds(new Set());
      return;
    }
    const sid = Number(selectedId);
    const next = new Set();
    for (const o of dateOverrides) {
      if (Number(o.staffId) === sid && o.isAvailable === false) next.add(String(o.date));
    }
    setLocalReds(next);
  }, [selectedId, dateOverrides]);

  const y = monthAnchor.getFullYear();
  const m = monthAnchor.getMonth();
  const cells = useMemo(() => buildMonthCells(y, m), [y, m]);
  const monthLabel = monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" });

  function toggleDay(iso) {
    if (!selectedId || !iso) return;
    setLocalReds((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  async function onSave() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const dateOverridesPayload = [...localReds].sort().map((date) => ({ date, isAvailable: false }));
      await api.putStaffDateOverrides(Number(selectedId), dateOverridesPayload, "unavailable");
      const ov = await api.getDateOverrides();
      setDateOverrides(ov?.dateOverrides ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card date-availability-card">
      <h2>Holiday Requests</h2>
      <p className="meta date-availability-intro">
        Pick a staff member, then click days to mark them as unavailable for the whole day (red). Clicking again removes
        the holiday mark.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="date-availability-toolbar">
        <label className="date-availability-staff-label">
          Staff member{" "}
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="date-availability-select">
            <option value="">Choose…</option>
            {staff.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!selectedId || saving} onClick={() => void onSave()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="date-availability-month-bar">
        <button type="button" className="secondary" onClick={() => setMonthAnchor(new Date(y, m - 1, 1))}>
          ← Prev
        </button>
        <span className="date-availability-month-title">{monthLabel}</span>
        <button type="button" className="secondary" onClick={() => setMonthAnchor(new Date(y, m + 1, 1))}>
          Next →
        </button>
      </div>

      <div className="date-availability-calendar" aria-hidden={!selectedId}>
        <div className="date-availability-dow-row">
          {WEEK_HEADERS.map((h) => (
            <div key={h} className="date-availability-dow">
              {h}
            </div>
          ))}
        </div>
        <div className="date-availability-grid">
          {cells.map((iso, idx) =>
            iso ? (
              <button
                key={iso}
                type="button"
                disabled={!selectedId}
                className={`date-availability-day${localReds.has(iso) ? " date-availability-day-off" : ""}`}
                onClick={() => toggleDay(iso)}
              >
                {Number(iso.slice(8, 10))}
              </button>
            ) : (
              <div key={`pad-${idx}`} className="date-availability-day date-availability-day-empty" />
            )
          )}
        </div>
      </div>
      {!selectedId && <p className="meta">Select a staff member to edit holiday overrides.</p>}
    </div>
  );
}

