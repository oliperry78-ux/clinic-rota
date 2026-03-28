/** Minutes before/after the clinic window that receptionists must still cover. */
export const RECEPTIONIST_BUFFER_MINUTES = 30;

const MINUTES_PER_DAY = 24 * 60;

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

function minutesToHHmm(totalMin) {
  const m = Math.max(0, Math.min(totalMin, MINUTES_PER_DAY - 1));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Receptionist coverage window: clinic window ± buffer. Same calendar day only — times clamp to 00:00–23:59.
 */
export function bufferedReceptionistWindow(clinicStart, clinicEnd) {
  if (!clinicStart || !clinicEnd) {
    return { required_start: null, required_end: null };
  }
  const cs = timeToMinutes(clinicStart);
  const ce = timeToMinutes(clinicEnd);
  if (ce <= cs) {
    return { required_start: null, required_end: null };
  }
  let rs = cs - RECEPTIONIST_BUFFER_MINUTES;
  let re = ce + RECEPTIONIST_BUFFER_MINUTES;
  rs = Math.max(0, rs);
  re = Math.min(MINUTES_PER_DAY - 1, re);
  if (re <= rs) {
    return { required_start: null, required_end: null };
  }
  return {
    required_start: minutesToHHmm(rs),
    required_end: minutesToHHmm(re),
  };
}

/**
 * Derive clinic-day metrics from session rows (same clinic + calendar date).
 * Times are HH:mm strings (same-day; lexicographic compare is valid).
 */
export function computeClinicDaySummary(sessions) {
  if (!sessions?.length) {
    return {
      clinic_start: null,
      clinic_end: null,
      required_start: null,
      required_end: null,
      required_capacity: 0,
      session_count: 0,
      active_rooms: 0,
    };
  }
  const starts = sessions.map((s) => s.start_time).filter(Boolean);
  const ends = sessions.map((s) => s.end_time).filter(Boolean);
  const clinic_start = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null;
  const clinic_end = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null;
  const { required_start, required_end } = bufferedReceptionistWindow(clinic_start, clinic_end);
  const roomSet = new Set(sessions.map((s) => String(s.room ?? "").trim()).filter(Boolean));
  const active_rooms = roomSet.size;
  const session_count = sessions.length;
  /** Distinct active rooms, or session count when no room labels (clinic-day staffing need). */
  const required_capacity = active_rooms > 0 ? active_rooms : session_count;
  return {
    clinic_start,
    clinic_end,
    required_start,
    required_end,
    required_capacity,
    session_count,
    active_rooms,
  };
}

export function formatRequiredCapacity(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const n = Number(value);
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 100) / 100).toString();
}
