import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { addDaysToISO, toISODate, weekDaysISO, weekRangeFromAnyDate, WEEKDAY_LABELS } from "../dates.js";

const REPEAT_ONCE = "once";
const REPEAT_WEEKLY = "weekly";
const REPEAT_BIWEEKLY = "biweekly";
const MAX_REPEAT_OCCURRENCES = 400;

function isDuplicateShiftError(err) {
  const m = String(err?.message ?? "");
  return m.includes("identical session") || m.includes("already exists");
}

/** Inclusive of first date and repeat-until date. */
function expandRepeatDates(firstISO, repeatMode, repeatUntilISO) {
  if (repeatMode === REPEAT_ONCE) return [firstISO];
  const step = repeatMode === REPEAT_WEEKLY ? 7 : 14;
  const dates = [];
  let d = firstISO;
  while (d <= repeatUntilISO) {
    dates.push(d);
    if (dates.length > MAX_REPEAT_OCCURRENCES) {
      throw new Error(`Too many occurrences (max ${MAX_REPEAT_OCCURRENCES}); shorten the repeat range`);
    }
    d = addDaysToISO(d, step);
  }
  return dates;
}

function groupByClinic(sessions) {
  const m = new Map();
  for (const s of sessions) {
    const key = String(s.clinic ?? "").trim() || "(no clinic)";
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(s);
  }
  for (const list of m.values()) {
    list.sort(
      (a, b) =>
        a.start_time.localeCompare(b.start_time) ||
        String(a.room || "").localeCompare(String(b.room || "")) ||
        String(a.doctor || "").localeCompare(String(b.doctor || ""))
    );
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function WeekShiftsPage() {
  const today = toISODate(new Date());
  const [weekAnchor, setWeekAnchor] = useState(today);
  const { startISO, endISO } = weekRangeFromAnyDate(weekAnchor);
  const days = weekDaysISO(startISO);

  const [shifts, setShifts] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newShift, setNewShift] = useState({
    shift_date: startISO,
    start_time: "09:00",
    end_time: "17:00",
    clinic: "",
    room: "",
    doctor: "",
    repeat_mode: REPEAT_ONCE,
    repeat_until: "",
  });
  const [editingShift, setEditingShift] = useState(null);

  async function load() {
    setError(null);
    try {
      const list = await api.getShifts(startISO, endISO);
      setShifts(list);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when week changes
  }, [startISO, endISO]);

  useEffect(() => {
    setEditingShift(null);
    setNotice(null);
  }, [startISO, endISO]);

  useEffect(() => {
    if (!days.includes(newShift.shift_date)) {
      setNewShift((s) => ({ ...s, shift_date: startISO }));
    }
  }, [days, newShift.shift_date, startISO]);

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const clinicTrim = String(newShift.clinic ?? "").trim();
    const roomTrim = String(newShift.room ?? "").trim();
    const doctorTrim = String(newShift.doctor ?? "").trim();
    if (!clinicTrim || !roomTrim || !doctorTrim) {
      setError("Clinic, room, and doctor are required");
      return;
    }
    const repeatMode = newShift.repeat_mode ?? REPEAT_ONCE;
    let dates;
    if (repeatMode === REPEAT_ONCE) {
      dates = [newShift.shift_date];
    } else {
      const until = String(newShift.repeat_until ?? "").trim();
      if (!until) {
        setError("Repeat until date is required for recurring sessions");
        return;
      }
      if (until < newShift.shift_date) {
        setError("Repeat until must be on or after the session date");
        return;
      }
      try {
        dates = expandRepeatDates(newShift.shift_date, repeatMode, until);
      } catch (err) {
        setError(err.message);
        return;
      }
    }

    setAdding(true);
    let created = 0;
    let skipped = 0;
    try {
      for (const shift_date of dates) {
        try {
          await api.createShift({
            shift_date,
            start_time: newShift.start_time,
            end_time: newShift.end_time,
            clinic: clinicTrim,
            room: roomTrim,
            doctor: doctorTrim,
          });
          created += 1;
        } catch (err) {
          if (isDuplicateShiftError(err)) {
            skipped += 1;
          } else {
            setError(err.message);
            await load();
            return;
          }
        }
      }
      await load();
      if (skipped > 0 && created === 0) {
        setNotice("No new sessions added — those dates already have this session.");
      } else if (skipped > 0) {
        setNotice(`Added ${created} session(s). ${skipped} date(s) skipped (already existed).`);
      } else if (dates.length > 1) {
        setNotice(`Added ${created} independent session(s). Each can be edited or deleted on its own.`);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveShiftEdit(ev) {
    ev.preventDefault();
    if (!editingShift) return;
    const clinicTrim = String(editingShift.clinic ?? "").trim();
    const roomTrim = String(editingShift.room ?? "").trim();
    const doctorTrim = String(editingShift.doctor ?? "").trim();
    if (!clinicTrim || !roomTrim || !doctorTrim) {
      setError("Clinic, room, and doctor are required");
      return;
    }
    setError(null);
    try {
      await api.updateShift(editingShift.id, {
        shift_date: editingShift.shift_date,
        start_time: editingShift.start_time,
        end_time: editingShift.end_time,
        clinic: clinicTrim,
        room: roomTrim,
        doctor: doctorTrim,
      });
      setEditingShift(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this session?")) return;
    setError(null);
    try {
      await api.deleteShift(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const byDate = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, []]));
    for (const s of shifts) {
      if (m[s.shift_date]) m[s.shift_date].push(s);
    }
    for (const d of days) {
      m[d].sort(
        (a, b) =>
          String(a.clinic || "").localeCompare(String(b.clinic || "")) ||
          a.start_time.localeCompare(b.start_time) ||
          String(a.room || "").localeCompare(String(b.room || "")) ||
          String(a.doctor || "").localeCompare(String(b.doctor || ""))
      );
    }
    return m;
  }, [shifts, days]);

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}

      <section className="card">
        <h2>Define sessions for a week</h2>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          Each row is a session (clinic, date, room, doctor, times). The same clinic can run multiple sessions the same
          day when room or doctor differs. Doctor is schedule metadata only — the rota does not assign clinical staff to
          sessions. Receptionist coverage is worked out on the Rota tab using capacity-based combinations per clinic-day
          block. Repeating patterns create separate sessions for each date (not a linked series).
        </p>
        <div className="week-toolbar">
          <label>
            Week containing{" "}
            <input type="date" value={weekAnchor} onChange={(e) => setWeekAnchor(e.target.value)} />
          </label>
          <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {startISO} → {endISO} (Mon–Sun)
          </span>
        </div>

        <form onSubmit={handleAdd} className="card" style={{ boxShadow: "none", marginBottom: "1rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Add session</h3>
          <div className="form-row" style={{ flexWrap: "wrap" }}>
            <div>
              <label>Date</label>
              <select
                value={newShift.shift_date}
                onChange={(e) => setNewShift((s) => ({ ...s, shift_date: e.target.value }))}
              >
                {days.map((iso, idx) => (
                  <option key={iso} value={iso}>
                    {WEEKDAY_LABELS[idx]} {iso}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Start</label>
              <input
                type="time"
                value={newShift.start_time}
                onChange={(e) => setNewShift((s) => ({ ...s, start_time: e.target.value }))}
              />
            </div>
            <div>
              <label>End</label>
              <input
                type="time"
                value={newShift.end_time}
                onChange={(e) => setNewShift((s) => ({ ...s, end_time: e.target.value }))}
              />
            </div>
            <div>
              <label>Clinic</label>
              <input
                value={newShift.clinic}
                onChange={(e) => setNewShift((s) => ({ ...s, clinic: e.target.value }))}
                required
                placeholder="e.g. Main"
              />
            </div>
            <div>
              <label>Room</label>
              <input
                value={newShift.room}
                onChange={(e) => setNewShift((s) => ({ ...s, room: e.target.value }))}
                required
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <label>Doctor</label>
              <input
                value={newShift.doctor}
                onChange={(e) => setNewShift((s) => ({ ...s, doctor: e.target.value }))}
                required
                placeholder="Name or ID"
              />
            </div>
            <div>
              <label>Repeat</label>
              <select
                value={newShift.repeat_mode}
                onChange={(e) =>
                  setNewShift((s) => ({
                    ...s,
                    repeat_mode: e.target.value,
                    repeat_until: e.target.value === REPEAT_ONCE ? "" : s.repeat_until,
                  }))
                }
              >
                <option value={REPEAT_ONCE}>One-off</option>
                <option value={REPEAT_WEEKLY}>Every week</option>
                <option value={REPEAT_BIWEEKLY}>Every other week</option>
              </select>
            </div>
            {newShift.repeat_mode !== REPEAT_ONCE && (
              <div>
                <label>Repeat until</label>
                <input
                  type="date"
                  value={newShift.repeat_until}
                  onChange={(e) => setNewShift((s) => ({ ...s, repeat_until: e.target.value }))}
                  required
                />
              </div>
            )}
            <button type="submit" disabled={adding}>
              {adding ? "Adding…" : newShift.repeat_mode === REPEAT_ONCE ? "Add session" : "Add sessions"}
            </button>
          </div>
        </form>

        <div className="week-grid">
          {days.map((iso, i) => (
            <div key={iso} className="day-column">
              <h3>
                {WEEKDAY_LABELS[i]} · {iso}
              </h3>
              {byDate[iso].length === 0 && (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>No sessions</p>
              )}
              {groupByClinic(byDate[iso]).map(([clinicName, list]) => (
                <div key={clinicName} style={{ marginBottom: "0.75rem" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "var(--muted)",
                      marginBottom: "0.35rem",
                    }}
                  >
                    {clinicName}
                  </div>
                  {list.map((s) =>
                    editingShift?.id === s.id ? (
                      <form key={s.id} className="shift-block" onSubmit={handleSaveShiftEdit}>
                        <div className="form-row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                          <div>
                            <label>Date</label>
                            <select
                              value={editingShift.shift_date}
                              onChange={(e) => setEditingShift((sh) => ({ ...sh, shift_date: e.target.value }))}
                            >
                              {days.map((d, j) => (
                                <option key={d} value={d}>
                                  {WEEKDAY_LABELS[j]} {d}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Start</label>
                            <input
                              type="time"
                              value={editingShift.start_time}
                              onChange={(e) => setEditingShift((sh) => ({ ...sh, start_time: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label>End</label>
                            <input
                              type="time"
                              value={editingShift.end_time}
                              onChange={(e) => setEditingShift((sh) => ({ ...sh, end_time: e.target.value }))}
                            />
                          </div>
                          <div style={{ flex: "1 1 6rem" }}>
                            <label>Clinic</label>
                            <input
                              value={editingShift.clinic}
                              onChange={(e) => setEditingShift((sh) => ({ ...sh, clinic: e.target.value }))}
                              required
                            />
                          </div>
                          <div style={{ flex: "1 1 5rem" }}>
                            <label>Room</label>
                            <input
                              value={editingShift.room}
                              onChange={(e) => setEditingShift((sh) => ({ ...sh, room: e.target.value }))}
                              required
                            />
                          </div>
                          <div style={{ flex: "1 1 6rem" }}>
                            <label>Doctor</label>
                            <input
                              value={editingShift.doctor}
                              onChange={(e) => setEditingShift((sh) => ({ ...sh, doctor: e.target.value }))}
                              required
                            />
                          </div>
                        </div>
                        <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <button type="submit">Save</button>
                          <button type="button" className="secondary" onClick={() => setEditingShift(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div key={s.id} className="shift-block">
                        <div>
                          {s.start_time}–{s.end_time}
                        </div>
                        <div className="meta">Clinic: {String(s.clinic || "").trim() || "—"}</div>
                        <div className="meta">Room: {String(s.room || "").trim() || "—"}</div>
                        <div className="meta">Doctor: {String(s.doctor || "").trim() || "—"}</div>
                        <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <button type="button" className="secondary" onClick={() => setEditingShift({ ...s })}>
                            Edit
                          </button>
                          <button type="button" className="danger" onClick={() => handleDelete(s.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
