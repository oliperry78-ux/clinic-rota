import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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

export default function PublicAvailabilityPage() {
  const { token } = useParams();
  const [status, setStatus] = useState("loading"); // "loading" | "error" | "ready"
  const [errorMsg, setErrorMsg] = useState("");
  const [staffName, setStaffName] = useState("");
  const [serverGreens, setServerGreens] = useState(() => new Set());
  const [localGreens, setLocalGreens] = useState(() => new Set());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  async function load() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const data = await api.getPublicAvailability(token);
      const greens = new Set(
        (data.dateOverrides ?? []).filter((o) => o.isAvailable).map((o) => String(o.date))
      );
      setStaffName(data.name ?? "");
      setServerGreens(greens);
      setLocalGreens(new Set(greens));
      setStatus("ready");
    } catch (e) {
      setErrorMsg(
        e.message || "Link not found or no longer active. Please contact your manager."
      );
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const y = monthAnchor.getFullYear();
  const m = monthAnchor.getMonth();
  const cells = useMemo(() => buildMonthCells(y, m), [y, m]);
  const monthLabel = monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" });

  const isDirty = useMemo(() => {
    if (status !== "ready") return false;
    if (serverGreens.size !== localGreens.size) return true;
    for (const d of localGreens) {
      if (!serverGreens.has(d)) return true;
    }
    return false;
  }, [status, serverGreens, localGreens]);

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function toggleDay(iso) {
    if (!iso || status !== "ready") return;
    setLocalGreens((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  async function onSave() {
    if (status !== "ready") return;
    setSaving(true);
    setSaveError(null);
    try {
      const dateOverrides = [...localGreens].sort().map((date) => ({ date, isAvailable: true }));
      const data = await api.putPublicAvailability(token, {
        dateOverrides,
        overrideScope: "available",
      });
      const greens = new Set(
        (data.dateOverrides ?? []).filter((o) => o.isAvailable).map((o) => String(o.date))
      );
      setServerGreens(greens);
      setLocalGreens(new Set(greens));
    } catch (e) {
      setSaveError(e.message || "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="card date-availability-card">
        <p className="meta">Loading…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="card date-availability-card">
        <h2>Date availability</h2>
        <p className="meta">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="card date-availability-card">
      <h2>Your date availability</h2>
      <p className="meta" style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
        {staffName} — click days you are available across any months, then press Save once to
        submit all changes.
      </p>
      <p className="meta date-availability-intro">
        Green days mark you as explicitly available on that date. You can move between months and
        select dates freely — one Save at the end will save everything at once. Other days follow
        your weekly pattern where it applies.
      </p>
      {saveError && <div className="error-banner">{saveError}</div>}
      <div className="date-availability-toolbar">
        {isDirty && <span className="date-availability-unsaved">Unsaved changes</span>}
        <button type="button" disabled={saving} onClick={() => void onSave()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="date-availability-month-bar">
        <button
          type="button"
          className="secondary"
          onClick={() => setMonthAnchor(new Date(y, m - 1, 1))}
        >
          ← Prev
        </button>
        <span className="date-availability-month-title">{monthLabel}</span>
        <button
          type="button"
          className="secondary"
          onClick={() => setMonthAnchor(new Date(y, m + 1, 1))}
        >
          Next →
        </button>
      </div>
      <div className="date-availability-calendar">
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
                className={`date-availability-day${localGreens.has(iso) ? " date-availability-day-on" : ""}`}
                onClick={() => toggleDay(iso)}
              >
                {Number(iso.slice(8, 10))}
              </button>
            ) : (
              <div
                key={`pad-${idx}`}
                className="date-availability-day date-availability-day-empty"
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
