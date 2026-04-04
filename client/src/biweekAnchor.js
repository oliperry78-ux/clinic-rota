/**
 * Mutable UTC Monday anchor for the repeating Week 1 / Week 2 availability cycle.
 * Matches server scheduling.js rules (UTC calendar interpretation of YYYY-MM-DD).
 */
const MS_DAY = 86400000;
const DEFAULT_ANCHOR_MONDAY_MS = Date.UTC(2000, 0, 3);

function utcMondayMsFromAnyIso(iso) {
  const [y, mo, d] = String(iso ?? "")
    .trim()
    .split("-")
    .map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return DEFAULT_ANCHOR_MONDAY_MS;
  const dayMs = Date.UTC(y, mo - 1, d);
  const dow = new Date(dayMs).getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  return dayMs - mondayOffset * MS_DAY;
}

function msToUtcIsoDate(ms) {
  const x = new Date(ms);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

let anchorMondayUtcMs = DEFAULT_ANCHOR_MONDAY_MS;

/** Set the Monday that starts "Week 1" (any date in that week is normalized to UTC Monday). */
export function configureBiweekWeek1Anchor(isoDateAny) {
  anchorMondayUtcMs = utcMondayMsFromAnyIso(isoDateAny || "2000-01-03");
}

export function getBiweekWeek1AnchorMondayIso() {
  return msToUtcIsoDate(anchorMondayUtcMs);
}

/** 0 = Week 1 pattern, 1 = Week 2 pattern — same formula as before, with configurable anchor. */
export function biweekCycleIndexFromIsoDate(isoDate) {
  const [y, mo, d] = String(isoDate).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
  const dayMs = Date.UTC(y, mo - 1, d);
  const dow = new Date(dayMs).getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const mondayMs = dayMs - mondayOffset * MS_DAY;
  const weeks = Math.floor((mondayMs - anchorMondayUtcMs) / (7 * MS_DAY));
  return ((weeks % 2) + 2) % 2;
}
