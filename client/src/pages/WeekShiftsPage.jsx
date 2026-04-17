import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useBiweekAnchor } from "../BiweekAnchorContext.jsx";
import { CLINIC_NAMES, CLINIC_ROOMS } from "../clinicConfig.js";
import { computeClinicDaySummary } from "../clinicDay.js";
import { generateReceptionistCombinations } from "../receptionistCombinations.js";
import {
  receptionistSelectionMapFromApiPayload,
  receptionistManualOverrideMapFromApiPayload,
  mergeReceptionistStateForDateRange,
  mergeReceptionistManualOverrideForDateRange,
} from "../rotaPersistence.js";
import {
  dateStringToDayOfWeek,
  eligibleAssistantsForSession,
  eligibleReceptionistsForBlock,
  isStaffAvailableForShiftWindow,
  staffAllowedAtClinic,
} from "../rotaEligibility.js";
import { receptionistComboIsCurrentlyValid } from "../rotaDisplay.js";
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

function classifyDoctors(isoDate, startTime, endTime, clinicName, staffList, dateOverrides) {
  const doctors = (Array.isArray(staffList) ? staffList : []).filter(
    (p) => String(p.role ?? "").trim().toLowerCase() === "doctor"
  );
  if (!isoDate || !startTime || !endTime) {
    return { available: doctors, unavailable: [] };
  }
  const dow = dateStringToDayOfWeek(isoDate);
  const clinic = String(clinicName ?? "").trim();
  const available = [];
  const unavailable = [];
  for (const doc of doctors) {
    const clinicOk = !clinic || staffAllowedAtClinic(doc, clinic);
    const timeOk = isStaffAvailableForShiftWindow(doc, isoDate, dow, startTime, endTime, dateOverrides);
    if (clinicOk && timeOk) available.push(doc);
    else unavailable.push(doc);
  }
  return { available, unavailable };
}

function DoctorSelect({ value, onChange, isoDate, startTime, endTime, clinicName, staffList, dateOverrides, anchorIso, required }) {
  const { available, unavailable } = useMemo(
    () => classifyDoctors(isoDate, startTime, endTime, clinicName, staffList, dateOverrides),
    // anchorIso included so this re-evaluates if the Week 1 anchor setting changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isoDate, startTime, endTime, clinicName, staffList, dateOverrides, anchorIso]
  );
  const knownNames = useMemo(
    () => new Set([...available, ...unavailable].map((d) => d.name)),
    [available, unavailable]
  );
  const showFallback = Boolean(value) && !knownNames.has(value);
  return (
    <select value={value} onChange={onChange} required={required}>
      <option value="">Select a doctor…</option>
      {showFallback && <option value={value}>— keep current ({value}) —</option>}
      {available.length > 0 && (
        <optgroup label="Available">
          {available.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
        </optgroup>
      )}
      {unavailable.length > 0 && (
        <optgroup label="Unavailable">
          {unavailable.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/**
 * Compact select for doctors assistant assignment.
 * Mirrors DoctorSelect exactly: Available / Unavailable optgroups, plus a fallback
 * option only when the assigned person has been deleted from the staff list entirely.
 */
function AssistantSelect({ value, onChange, session, staffList, allShifts, dateOverrides }) {
  const eligible = eligibleAssistantsForSession(staffList, allShifts, session, dateOverrides);
  const eligibleIds = new Set(eligible.map((a) => Number(a.id)));
  const unavailable = (Array.isArray(staffList) ? staffList : []).filter((p) => {
    const role = String(p.role || "").toLowerCase().trim();
    return (role === "doctors assistant" || role === "assistant") && !eligibleIds.has(Number(p.id));
  });
  const numValue = value !== "" && value != null ? Number(value) : "";
  // Show a fallback only when the assigned person is no longer in the staff list at all (deleted).
  // If they are still in the list they appear naturally in the Unavailable group below.
  const knownIds = new Set([...eligible, ...unavailable].map((a) => Number(a.id)));
  const showFallback = numValue !== "" && !knownIds.has(numValue);
  return (
    <select value={numValue} onChange={onChange}>
      <option value="">— Unassigned —</option>
      {showFallback && (
        <option value={numValue}>— keep current (Staff #{numValue}) —</option>
      )}
      {eligible.length > 0 && (
        <optgroup label="Available">
          {eligible.map((a) => (
            <option key={a.id} value={Number(a.id)}>{a.name}</option>
          ))}
        </optgroup>
      )}
      {unavailable.length > 0 && (
        <optgroup label="Unavailable">
          {unavailable.map((a) => (
            <option key={a.id} value={Number(a.id)}>{a.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
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
    clinic: CLINIC_NAMES[0],
    room: CLINIC_ROOMS[CLINIC_NAMES[0]][0],
    doctor: "",
    assistant: "",
    repeat_mode: REPEAT_ONCE,
    repeat_until: "",
  });
  const [editingShift, setEditingShift] = useState(null);
  const { anchorIso } = useBiweekAnchor();
  const [staff, setStaff] = useState([]);
  const [dateOverrides, setDateOverrides] = useState([]);
  const [selectedReceptionistByBlock, setSelectedReceptionistByBlock] = useState({});
  const [receptionistManualOverrideByBlock, setReceptionistManualOverrideByBlock] = useState({});

  /**
   * Single load that fetches everything for the current week together so
   * receptionist labels are always built with a fresh staff list.
   */
  async function load() {
    setError(null);
    try {
      const [sList, ovData, list, rxPayload] = await Promise.all([
        api.getStaff(),
        api.getDateOverrides(),
        api.getShifts(startISO, endISO),
        api.getClinicDayReceptionistSlots(startISO, endISO),
      ]);
      setStaff(sList);
      setDateOverrides(ovData?.dateOverrides ?? []);
      setShifts(list);
      const loadedRx = receptionistSelectionMapFromApiPayload(rxPayload, sList);
      const loadedRxManual = receptionistManualOverrideMapFromApiPayload(rxPayload);
      setSelectedReceptionistByBlock((prev) =>
        mergeReceptionistStateForDateRange(prev, loadedRx, startISO, endISO)
      );
      setReceptionistManualOverrideByBlock((prev) =>
        mergeReceptionistManualOverrideForDateRange(prev, loadedRxManual, startISO, endISO)
      );
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

    const rawNewAssistantId = newShift.assistant;
    const newAssistantId = rawNewAssistantId ? Number(rawNewAssistantId) || null : null;

    setAdding(true);
    let created = 0;
    let skipped = 0;
    try {
      for (const shift_date of dates) {
        try {
          const createdShift = await api.createShift({
            shift_date,
            start_time: newShift.start_time,
            end_time: newShift.end_time,
            clinic: clinicTrim,
            room: roomTrim,
            doctor: doctorTrim,
          });
          if (newAssistantId && createdShift?.id) {
            const sessionForElig = { ...newShift, shift_date };
            const eligible = eligibleAssistantsForSession(staff, shifts, sessionForElig, dateOverrides);
            const isOverride = !eligible.some((a) => Number(a.id) === newAssistantId);
            await api.assignShiftStaff(createdShift.id, newAssistantId, {
              assigned_staff_manual_override: isOverride,
            });
          }
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

      // Save doctors assistant assignment alongside the core session fields.
      const rawAssistantId = editingShift.assigned_staff_id;
      const newAssistantId =
        rawAssistantId === "" || rawAssistantId == null ? null : Number(rawAssistantId) || null;
      const eligible = eligibleAssistantsForSession(staff, shifts, editingShift, dateOverrides);
      const isOverride = newAssistantId
        ? !eligible.some((a) => Number(a.id) === newAssistantId)
        : false;
      await api.assignShiftStaff(editingShift.id, newAssistantId, {
        assigned_staff_manual_override: isOverride,
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

  /** Save receptionist combo selection for a clinic-day block. */
  async function handleReceptionistChange(isoDate, clinicName, newLabel, combos, unavailableCombos) {
    const key = `${isoDate}\0${clinicName}`;
    setError(null);
    try {
      if (!newLabel) {
        await api.putClinicDayReceptionistSlots({ shift_date: isoDate, clinic: clinicName, staffIds: [] });
        setSelectedReceptionistByBlock((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setReceptionistManualOverrideByBlock((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } else {
        // Check available combos first; fall back to unavailable (manual override).
        const availableCombo = combos.find((c) => c.label === newLabel);
        const combo = availableCombo ?? (unavailableCombos ?? []).find((c) => c.label === newLabel);
        if (!combo) return;
        const isManual = !availableCombo;
        const staffIds = combo.contributions.map((c) => Number(c.staffId));
        await api.putClinicDayReceptionistSlots({
          shift_date: isoDate,
          clinic: clinicName,
          staffIds,
          manualOverrides: staffIds.map(() => isManual),
        });
        setSelectedReceptionistByBlock((prev) => ({ ...prev, [key]: newLabel }));
        setReceptionistManualOverrideByBlock((prev) => ({ ...prev, [key]: isManual }));
      }
    } catch (e) {
      setError(e.message);
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

  /** Fast id → staff lookup used in the session view cards. */
  const staffById = useMemo(() => {
    const m = new Map();
    for (const p of staff) m.set(Number(p.id), p);
    return m;
  }, [staff]);

  /**
   * Per-clinic-day: receptionist combinations split into available and unavailable.
   * Available  = all members pass eligibleReceptionistsForBlock for this window.
   * Unavailable = at least one member does not (selecting one saves as manual override).
   * Uses the same shared eligibility + combination logic as RotaPage.
   */
  const combinationCache = useMemo(() => {
    const cache = new Map();
    for (const iso of days) {
      for (const [clinicName, sessions] of groupByClinic(byDate[iso] ?? [])) {
        const key = `${iso}\0${clinicName}`;
        const summary = computeClinicDaySummary(sessions);

        // Eligible staff (pass availability window check).
        const eligibleStaff = eligibleReceptionistsForBlock(
          staff,
          clinicName,
          iso,
          summary.required_start,
          summary.required_end,
          dateOverrides
        );
        const eligibleIds = new Set(eligibleStaff.map((p) => Number(p.id)));

        // All receptionists allowed at this clinic regardless of time availability.
        const allForBlock = staff
          .filter(
            (p) =>
              String(p.role || "").trim().toLowerCase() === "receptionist" &&
              staffAllowedAtClinic(p, clinicName)
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            capacity: p.capacity ?? 1,
            staff_type: p.staff_type ?? "Full time",
          }));

        // Generate all combinations (available + unavailable) from the full pool.
        const allCombos = generateReceptionistCombinations(allForBlock, summary.required_capacity);
        const combos = allCombos.filter((c) =>
          c.contributions.every((contrib) => eligibleIds.has(Number(contrib.staffId)))
        );
        const unavailableCombos = allCombos.filter((c) =>
          c.contributions.some((contrib) => !eligibleIds.has(Number(contrib.staffId)))
        );

        cache.set(key, { summary, combos, unavailableCombos });
      }
    }
    return cache;
  }, [staff, dateOverrides, byDate, days]);

  /** Per-session: eligible doctors assistants (used for validity display in view mode). */
  const assistantEligibilityCache = useMemo(() => {
    const cache = new Map();
    for (const s of shifts) {
      cache.set(s.id, eligibleAssistantsForSession(staff, shifts, s, dateOverrides));
    }
    return cache;
  }, [staff, shifts, dateOverrides]);

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
              <select
                value={newShift.clinic}
                onChange={(e) => {
                  const clinic = e.target.value;
                  setNewShift((s) => ({ ...s, clinic, room: (CLINIC_ROOMS[clinic] ?? [""])[0] }));
                }}
                required
              >
                {CLINIC_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Room</label>
              <select
                value={newShift.room}
                onChange={(e) => setNewShift((s) => ({ ...s, room: e.target.value }))}
                required
              >
                {(CLINIC_ROOMS[newShift.clinic] ?? []).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Doctor</label>
              <DoctorSelect
                value={newShift.doctor}
                onChange={(e) => setNewShift((s) => ({ ...s, doctor: e.target.value }))}
                isoDate={newShift.shift_date}
                startTime={newShift.start_time}
                endTime={newShift.end_time}
                clinicName={newShift.clinic}
                staffList={staff}
                dateOverrides={dateOverrides}
                anchorIso={anchorIso}
                required
              />
            </div>
            <div>
              <label>Assistant</label>
              <AssistantSelect
                value={newShift.assistant}
                onChange={(e) => setNewShift((s) => ({ ...s, assistant: e.target.value }))}
                session={newShift}
                staffList={staff}
                allShifts={shifts}
                dateOverrides={dateOverrides}
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
              {groupByClinic(byDate[iso]).map(([clinicName, list]) => {
                const blockKey = `${iso}\0${clinicName}`;
                const { combos, unavailableCombos } =
                  combinationCache.get(blockKey) ?? { combos: [], unavailableCombos: [] };
                const selectedLabel = selectedReceptionistByBlock[blockKey] ?? null;
                const rxInvalid =
                  Boolean(selectedLabel) && !receptionistComboIsCurrentlyValid(selectedLabel, combos);

                return (
                  <div key={clinicName} style={{ marginBottom: "0.75rem" }}>
                    {/* Clinic heading */}
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "var(--muted)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {clinicName}
                    </div>

                    {/* Receptionist assignment — once per clinic-day block, NOT per session */}
                    <div
                      style={{
                        fontSize: "0.75rem",
                        marginBottom: "0.4rem",
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                        gap: "0.3rem",
                      }}
                    >
                      <span style={{ color: "var(--muted)" }}>Receptionist:</span>
                      {/* Fix 2: show full label in red when invalid, matching assistant/doctor pattern */}
                      {rxInvalid && selectedLabel && (
                        <span className="rota-assignment-invalid">
                          {selectedLabel} (unavailable)
                        </span>
                      )}
                      {/* Fix 3: use Available optgroup to match doctor/assistant dropdown style */}
                      <select
                        value={rxInvalid ? "" : (selectedLabel ?? "")}
                        onChange={(e) =>
                          void handleReceptionistChange(
                            iso, clinicName, e.target.value, combos, unavailableCombos
                          )
                        }
                        style={{ fontSize: "0.75rem" }}
                      >
                        <option value="">— Unassigned —</option>
                        {combos.length > 0 && (
                          <optgroup label="Available">
                            {combos.map((c) => (
                              <option key={c.label} value={c.label}>{c.label}</option>
                            ))}
                          </optgroup>
                        )}
                        {unavailableCombos.length > 0 && (
                          <optgroup label="Unavailable">
                            {unavailableCombos.map((c) => (
                              <option key={c.label} value={c.label}>{c.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {!rxInvalid && selectedLabel && receptionistManualOverrideByBlock[blockKey] && (
                        <span className="rota-manual-override-label" style={{ fontSize: "0.7rem" }}>
                          (manual)
                        </span>
                      )}
                    </div>

                    {/* Session cards */}
                    {list.map((s) =>
                      editingShift?.id === s.id ? (
                        <form key={s.id} className="shift-block" onSubmit={handleSaveShiftEdit}>
                          <div className="form-row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                            <div>
                              <label>Date</label>
                              <select
                                value={editingShift.shift_date}
                                onChange={(e) =>
                                  setEditingShift((sh) => ({ ...sh, shift_date: e.target.value }))
                                }
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
                                onChange={(e) =>
                                  setEditingShift((sh) => ({ ...sh, start_time: e.target.value }))
                                }
                              />
                            </div>
                            <div>
                              <label>End</label>
                              <input
                                type="time"
                                value={editingShift.end_time}
                                onChange={(e) =>
                                  setEditingShift((sh) => ({ ...sh, end_time: e.target.value }))
                                }
                              />
                            </div>
                            <div style={{ flex: "1 1 6rem" }}>
                              <label>Clinic</label>
                              <select
                                value={editingShift.clinic}
                                onChange={(e) => {
                                  const clinic = e.target.value;
                                  setEditingShift((sh) => ({
                                    ...sh,
                                    clinic,
                                    room: (CLINIC_ROOMS[clinic] ?? [""])[0],
                                  }));
                                }}
                                required
                              >
                                {CLINIC_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div style={{ flex: "1 1 5rem" }}>
                              <label>Room</label>
                              <select
                                value={editingShift.room}
                                onChange={(e) =>
                                  setEditingShift((sh) => ({ ...sh, room: e.target.value }))
                                }
                                required
                              >
                                {(CLINIC_ROOMS[editingShift.clinic] ?? []).map((r) => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ flex: "1 1 6rem" }}>
                              <label>Doctor</label>
                              <DoctorSelect
                                value={editingShift.doctor}
                                onChange={(e) =>
                                  setEditingShift((sh) => ({ ...sh, doctor: e.target.value }))
                                }
                                isoDate={editingShift.shift_date}
                                startTime={editingShift.start_time}
                                endTime={editingShift.end_time}
                                clinicName={editingShift.clinic}
                                staffList={staff}
                                dateOverrides={dateOverrides}
                                anchorIso={anchorIso}
                                required
                              />
                            </div>
                            <div style={{ flex: "1 1 6rem" }}>
                              <label>Assistant</label>
                              <AssistantSelect
                                value={editingShift.assigned_staff_id ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEditingShift((sh) => ({
                                    ...sh,
                                    assigned_staff_id: v !== "" ? Number(v) : null,
                                  }));
                                }}
                                session={editingShift}
                                staffList={staff}
                                allShifts={shifts}
                                dateOverrides={dateOverrides}
                              />
                            </div>
                          </div>
                          <div
                            style={{ marginTop: "0.35rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}
                          >
                            <button type="submit">Save</button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setEditingShift(null)}
                            >
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
                          {/* Doctor — same invalid-state check used by RotaPage */}
                          {(() => {
                            const doctorName = String(s.doctor || "").trim();
                            const doctorStaff = doctorName
                              ? staff.find(
                                  (p) =>
                                    String(p.role ?? "").trim().toLowerCase() === "doctor" &&
                                    p.name === doctorName
                                )
                              : null;
                            const doctorIsUnavailable =
                              Boolean(doctorStaff) &&
                              !isStaffAvailableForShiftWindow(
                                doctorStaff,
                                s.shift_date,
                                dateStringToDayOfWeek(s.shift_date),
                                s.start_time,
                                s.end_time,
                                dateOverrides
                              );
                            return (
                              <div className="meta">
                                Doctor:{" "}
                                {doctorIsUnavailable ? (
                                  <span className="rota-assignment-invalid">
                                    {doctorName} (unavailable)
                                  </span>
                                ) : (
                                  doctorName || "—"
                                )}
                              </div>
                            );
                          })()}
                          {/* Doctors assistant — session level */}
                          {(() => {
                            const assignedId = s.assigned_staff_id ?? null;
                            const assigned = assignedId ? staffById.get(Number(assignedId)) : null;
                            const eligible = assistantEligibilityCache.get(s.id) ?? [];
                            const isInvalid =
                              Boolean(assignedId) &&
                              !eligible.some((a) => Number(a.id) === Number(assignedId));
                            return (
                              <div className="meta">
                                Assistant:{" "}
                                {assignedId ? (
                                  <span className={isInvalid ? "rota-assignment-invalid" : undefined}>
                                    {assigned?.name ?? `Staff #${assignedId}`}
                                    {isInvalid ? " (unavailable)" : ""}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </div>
                            );
                          })()}
                          <div
                            style={{
                              marginTop: "0.35rem",
                              display: "flex",
                              gap: "0.35rem",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setEditingShift({ ...s })}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDelete(s.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
