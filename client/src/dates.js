/**
 * Helpers for calendar weeks. We use Monday as the first day of the working week
 * (common for UK clinics). Dates are local YYYY-MM-DD strings — no timezone conversion.
 */

export function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Add calendar days to an ISO date string (local calendar, no UTC shift). */
export function addDaysToISO(iso, deltaDays) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + deltaDays);
  return toISODate(d);
}

/** Monday of the week containing `isoDate` (local). */
export function mondayOfWeek(isoDate) {
  const d = parseISODate(isoDate);
  const jsDay = d.getDay(); // 0 Sun .. 6 Sat
  const offset = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + offset);
  return d;
}

/** Returns { startISO, endISO } for Mon–Sun inclusive. */
export function weekRangeFromAnyDate(isoDate) {
  const mon = mondayOfWeek(isoDate);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return { startISO: toISODate(mon), endISO: toISODate(sun) };
}

/** Seven dates Mon→Sun as ISO strings. */
export function weekDaysISO(startMondayISO) {
  const mon = parseISODate(startMondayISO);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon);
    x.setDate(x.getDate() + i);
    out.push(toISODate(x));
  }
  return out;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
