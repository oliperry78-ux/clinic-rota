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

/**
 * Shared date availability calendar + save (explicit available overrides only).
 * Same API path as the manager Date Availability page.
 *
 * @param {object} props
 * @param {number | null} props.staffId — when null, calendar is disabled
 * @param {string} [props.mainTitle="Date Availability"]
 * @param {import("react").ReactNode} [props.intro]
 * @param {string} [props.staffBanner] — e.g. temp name line under the title
 * @param {import("react").ReactNode} [props.managerToolbar] — e.g. staff dropdown (manager only)
 * @param {boolean} [props.hideSelectPrompt] — hide “Select a staff member…” (e.g. temp self-serve page)
 */
export default function DateAvailabilityEditor({
  staffId,
  mainTitle = "Date Availability",
  intro = null,
  staffBanner = null,
  managerToolbar = null,
  hideSelectPrompt = false,
}) {
  const [dateOverrides, setDateOverrides] = useState([]);
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [localGreens, setLocalGreens] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function loadOverrides() {
    setError(null);
    try {
      const ov = await api.getDateOverrides();
      setDateOverrides(ov?.dateOverrides ?? []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void loadOverrides();
  }, []);

  useEffect(() => {
    if (staffId == null || !Number.isFinite(Number(staffId))) {
      setLocalGreens(new Set());
      return;
    }
    const sid = Number(staffId);
    const next = new Set();
    for (const o of dateOverrides) {
      if (Number(o.staffId) === sid && o.isAvailable) next.add(String(o.date));
    }
    setLocalGreens(next);
  }, [staffId, dateOverrides]);

  const y = monthAnchor.getFullYear();
  const m = monthAnchor.getMonth();
  const cells = useMemo(() => buildMonthCells(y, m), [y, m]);
  const monthLabel = monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" });
  const canEdit = staffId != null && Number.isFinite(Number(staffId)) && Number(staffId) > 0;

  function toggleDay(iso) {
    if (!canEdit || !iso) return;
    setLocalGreens((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  async function onSave() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const dateOverridesPayload = [...localGreens].sort().map((date) => ({ date, isAvailable: true }));
      await api.putStaffDateOverrides(Number(staffId), dateOverridesPayload, "available");
      await loadOverrides();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2>{mainTitle}</h2>
      {staffBanner && (
        <p className="meta" style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
          {staffBanner}
        </p>
      )}
      {intro}
      {error && <div className="error-banner">{error}</div>}

      <div className="date-availability-toolbar">
        {managerToolbar}
        <button type="button" disabled={!canEdit || saving} onClick={() => void onSave()}>
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

      <div className="date-availability-calendar" aria-hidden={!canEdit}>
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
                disabled={!canEdit}
                className={`date-availability-day${localGreens.has(iso) ? " date-availability-day-on" : ""}`}
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
      {!canEdit && !hideSelectPrompt && (
        <p className="meta">Select a staff member to edit date overrides.</p>
      )}
    </>
  );
}
