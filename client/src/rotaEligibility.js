/** Match server `scheduling.js` weekday from ISO date (UTC). */
export function dateStringToDayOfWeek(isoDate) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

const MINUTES_PER_DAY = 24 * 60;
const ASSISTANT_BUFFER_MINUTES = 30;

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Same rule as server: entire window must sit inside one availability band for that weekday. */
export function isWithinAvailability(availability, dayOfWeek, shiftStart, shiftEnd) {
  const slots = Array.isArray(availability) ? availability : [];
  const s = timeToMinutes(shiftStart);
  const e = timeToMinutes(shiftEnd);
  if (e <= s) return false;
  return slots.some((slot) => {
    if (slot.day !== dayOfWeek) return false;
    const as = timeToMinutes(slot.start);
    const ae = timeToMinutes(slot.end);
    return as <= s && e <= ae;
  });
}

export function staffAllowedAtClinic(staff, clinicTrim) {
  const ac = staff.allowed_clinics;
  if (!ac || ac.all) return true;
  const c = String(clinicTrim).toLowerCase();
  return (Array.isArray(ac.clinics) ? ac.clinics : []).some((x) => String(x).trim().toLowerCase() === c);
}

function bufferedSessionWindow(startTime, endTime) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  const rs = Math.max(0, s - ASSISTANT_BUFFER_MINUTES);
  const re = Math.min(MINUTES_PER_DAY - 1, e + ASSISTANT_BUFFER_MINUTES);
  if (re <= rs) return null;
  return { startMin: rs, endMin: re };
}

/**
 * Receptionists who may cover this clinic-day block (role + clinic allow-list + availability).
 * `requiredStart` / `requiredEnd` are the buffered window (e.g. clinic ± 30 minutes); eligibility requires
 * one availability band that fully contains that interval (no partial overlap).
 */
export function eligibleReceptionistsForBlock(staffList, clinicTrim, isoDate, requiredStart, requiredEnd) {
  if (!requiredStart || !requiredEnd) return [];
  const dow = dateStringToDayOfWeek(isoDate);
  return staffList.filter((p) => {
    if (String(p.role || "").trim().toLowerCase() !== "receptionist") return false;
    if (!staffAllowedAtClinic(p, clinicTrim)) return false;
    return isWithinAvailability(p.availability, dow, requiredStart, requiredEnd);
  });
}

/**
 * Doctors assistants eligible for a specific session (session-level):
 * role + clinic allow-list + availability for buffered session window + no overlap with other
 * buffered sessions this doctors assistant is already assigned to.
 */
export function eligibleAssistantsForSession(staffList, allShifts, targetShift) {
  if (!targetShift?.shift_date || !targetShift?.start_time || !targetShift?.end_time) return [];
  const targetWin = bufferedSessionWindow(targetShift.start_time, targetShift.end_time);
  if (!targetWin) return [];

  const dow = dateStringToDayOfWeek(targetShift.shift_date);
  const clinicTrim = String(targetShift.clinic || "").trim();
  const shifts = Array.isArray(allShifts) ? allShifts : [];

  return (Array.isArray(staffList) ? staffList : []).filter((p) => {
    const role = String(p.role || "").trim().toLowerCase();
    if (role !== "doctors assistant" && role !== "assistant") return false;
    if (!staffAllowedAtClinic(p, clinicTrim)) return false;

    // Availability must cover full buffered session window.
    const requiredStart = `${String(Math.floor(targetWin.startMin / 60)).padStart(2, "0")}:${String(targetWin.startMin % 60).padStart(2, "0")}`;
    const requiredEnd = `${String(Math.floor(targetWin.endMin / 60)).padStart(2, "0")}:${String(targetWin.endMin % 60).padStart(2, "0")}`;
    if (!isWithinAvailability(p.availability, dow, requiredStart, requiredEnd)) return false;

    // Block if already assigned to another overlapping buffered session.
    for (const s of shifts) {
      if (s.id === targetShift.id) continue;
      if (String(s.shift_date) !== String(targetShift.shift_date)) continue;
      if (Number(s.assigned_staff_id) !== Number(p.id)) continue;
      const otherWin = bufferedSessionWindow(s.start_time, s.end_time);
      if (!otherWin) continue;
      if (rangesOverlap(targetWin.startMin, targetWin.endMin, otherWin.startMin, otherWin.endMin)) {
        return false;
      }
    }

    return true;
  });
}
