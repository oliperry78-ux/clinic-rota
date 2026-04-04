/**
 * Core rota rules (v1):
 * 1) Role must match the shift's required role.
 * 2) Staff must have availability covering the whole shift on that weekday.
 * 3) No overlapping shifts for the same person (same calendar day, time ranges overlap).
 */

/** Parse "HH:mm" to minutes since midnight for easy comparisons. */
export function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Day of week 0–6 (Sunday = 0) to match JavaScript Date.getUTCDay if we use UTC dates. */
export function dateStringToDayOfWeek(isoDate) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCDay();
}

/** Default UTC Monday anchor (backward compatible when no custom anchor is passed). */
const DEFAULT_BIWEEK_ANCHOR_MONDAY_UTC_MS = Date.UTC(2000, 0, 3);

/**
 * Which biweek half the calendar week of `isoDate` falls in: 0 = week 1 pattern, 1 = week 2 pattern.
 * Uses the Monday-start week containing the date (UTC), same calendar interpretation as `dateStringToDayOfWeek`.
 * Optional `anchorMondayUtcMs` defaults to 2000-01-03 UTC Monday to preserve legacy behaviour.
 */
export function biweekCycleIndexFromIsoDate(isoDate, anchorMondayUtcMs = DEFAULT_BIWEEK_ANCHOR_MONDAY_UTC_MS) {
  const [y, mo, d] = String(isoDate).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
  const dayMs = Date.UTC(y, mo - 1, d);
  const dow = new Date(dayMs).getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const mondayMs = dayMs - mondayOffset * 24 * 60 * 60 * 1000;
  const weeks = Math.floor((mondayMs - anchorMondayUtcMs) / (7 * 24 * 60 * 60 * 1000));
  return ((weeks % 2) + 2) % 2;
}

export function availabilitySlotsForIsoDate(availabilityParsed, isoDate, anchorMondayUtcMs = DEFAULT_BIWEEK_ANCHOR_MONDAY_UTC_MS) {
  const idx = biweekCycleIndexFromIsoDate(isoDate, anchorMondayUtcMs);
  const w1 = Array.isArray(availabilityParsed?.week1) ? availabilityParsed.week1 : [];
  const w2 = Array.isArray(availabilityParsed?.week2) ? availabilityParsed.week2 : [];
  return idx === 0 ? w1 : w2;
}

/** Full-window containment for the correct biweek pattern on `isoDate`. */
export function isWithinAvailabilityForIsoDate(
  availabilityParsed,
  isoDate,
  dayOfWeek,
  shiftStart,
  shiftEnd,
  anchorMondayUtcMs = DEFAULT_BIWEEK_ANCHOR_MONDAY_UTC_MS
) {
  const slots = availabilitySlotsForIsoDate(availabilityParsed, isoDate, anchorMondayUtcMs);
  return isWithinAvailability(slots, dayOfWeek, shiftStart, shiftEnd);
}

/** Normalize API/DB payload to { week1, week2 } before persisting. */
export function normalizeAvailabilityForStorage(input) {
  if (input == null) return { week1: [], week2: [] };
  if (Array.isArray(input)) return { week1: input, week2: input };
  if (typeof input === "object") {
    return {
      week1: Array.isArray(input.week1) ? input.week1 : [],
      week2: Array.isArray(input.week2) ? input.week2 : [],
    };
  }
  return { week1: [], week2: [] };
}

/**
 * True if [aStart, aEnd) overlaps [bStart, bEnd) on the same timeline.
 * Touching at boundary (end === other start) is NOT overlap.
 */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Whether staff availability includes this entire shift window on that weekday. */
export function isWithinAvailability(availability, dayOfWeek, shiftStart, shiftEnd) {
  const s = timeToMinutes(shiftStart);
  const e = timeToMinutes(shiftEnd);
  if (e <= s) return false; // invalid or overnight (v1: not supported)

  return availability.some((slot) => {
    if (slot.day !== dayOfWeek) return false;
    const as = timeToMinutes(slot.start);
    const ae = timeToMinutes(slot.end);
    return as <= s && e <= ae;
  });
}

/**
 * Find any other shift on the same date assigned to staffId that overlaps this window.
 * excludeShiftId: pass when re-assigning the same row so it doesn't clash with itself.
 */
export function findOverlappingAssignment(db, staffId, shiftDate, startTime, endTime, excludeShiftId) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);

  const rows = db
    .prepare(
      `SELECT id, start_time, end_time FROM shifts
       WHERE assigned_staff_id = ?
         AND shift_date = ?
         AND id != ?`
    )
    .all(staffId, shiftDate, excludeShiftId ?? 0);

  for (const row of rows) {
    const rs = timeToMinutes(row.start_time);
    const re = timeToMinutes(row.end_time);
    if (rangesOverlap(s, e, rs, re)) return row;
  }
  return null;
}

/** Earliest start / latest end for all sessions on this clinic-day (trimmed clinic match). */
export function getClinicDayWindowFromDb(db, shiftDate, clinic) {
  const row = db
    .prepare(
      `SELECT MIN(start_time) AS min_s, MAX(end_time) AS max_e
       FROM shifts
       WHERE shift_date = ? AND trim(clinic) = trim(?)`
    )
    .get(shiftDate, clinic);
  if (!row?.min_s || !row?.max_e) return null;
  return { start: row.min_s, end: row.max_e };
}

export function activeRoomCountForClinicDay(db, shiftDate, clinic) {
  const rows = db
    .prepare(
      `SELECT DISTINCT trim(room) AS r FROM shifts
       WHERE shift_date = ? AND trim(clinic) = trim(?) AND length(trim(room)) > 0`
    )
    .all(shiftDate, clinic);
  return rows.length;
}

export function sessionCountForClinicDay(db, shiftDate, clinic) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM shifts WHERE shift_date = ? AND trim(clinic) = trim(?)`)
    .get(shiftDate, clinic);
  return row?.n ?? 0;
}

/** Receptionist slots needed: distinct active rooms, or session count if no room labels. */
export function requiredReceptionistCapacityForClinicDay(db, shiftDate, clinic) {
  const rooms = activeRoomCountForClinicDay(db, shiftDate, clinic);
  if (rooms > 0) return rooms;
  return sessionCountForClinicDay(db, shiftDate, clinic);
}

/** Other clinic-day receptionist slots for this staff on the same calendar day that overlap in time. */
export function findOverlappingReceptionistBlock(db, staffId, shiftDate, winStart, winEnd, excludeSlotId) {
  const ws = timeToMinutes(winStart);
  const we = timeToMinutes(winEnd);
  const slots = db
    .prepare(
      `SELECT id, clinic FROM clinic_day_receptionist_slots
       WHERE staff_id = ? AND shift_date = ?`
    )
    .all(staffId, shiftDate);
  for (const sl of slots) {
    if (excludeSlotId != null && sl.id === excludeSlotId) continue;
    const w = getClinicDayWindowFromDb(db, shiftDate, sl.clinic);
    if (!w) continue;
    const bs = timeToMinutes(w.start);
    const be = timeToMinutes(w.end);
    if (rangesOverlap(ws, we, bs, be)) return { id: sl.id, clinic: sl.clinic };
  }
  return null;
}

/** Session-level assignment overlapping a receptionist block window for this staff. */
export function findSessionAssignmentOverlappingReceptionistBlock(db, staffId, shiftDate, startTime, endTime) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  const slots = db
    .prepare(
      `SELECT id, clinic FROM clinic_day_receptionist_slots
       WHERE staff_id = ? AND shift_date = ?`
    )
    .all(staffId, shiftDate);
  for (const sl of slots) {
    const w = getClinicDayWindowFromDb(db, shiftDate, sl.clinic);
    if (!w) continue;
    if (rangesOverlap(s, e, timeToMinutes(w.start), timeToMinutes(w.end))) return { block_slot_id: sl.id, clinic: sl.clinic };
  }
  return null;
}

export function staffAlreadyInReceptionistBlock(db, shiftDate, clinic, staffId, excludeSlotId) {
  const row = excludeSlotId
    ? db
        .prepare(
          `SELECT id FROM clinic_day_receptionist_slots
           WHERE shift_date = ? AND trim(clinic) = trim(?) AND staff_id = ? AND id != ?`
        )
        .get(shiftDate, clinic, staffId, excludeSlotId)
    : db
        .prepare(
          `SELECT id FROM clinic_day_receptionist_slots
           WHERE shift_date = ? AND trim(clinic) = trim(?) AND staff_id = ?`
        )
        .get(shiftDate, clinic, staffId);
  return row ?? null;
}

export function parseAvailabilityJson(json) {
  try {
    const raw = JSON.parse(json);
    if (Array.isArray(raw)) return { week1: raw, week2: raw };
    if (raw && typeof raw === "object") {
      return {
        week1: Array.isArray(raw.week1) ? raw.week1 : [],
        week2: Array.isArray(raw.week2) ? raw.week2 : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { week1: [], week2: [] };
}
