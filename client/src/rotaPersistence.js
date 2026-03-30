/**
 * Maps persisted clinic-day receptionist rows to the block-key + combo label used by the rota UI.
 */

function contributionLabelFromStaff(p, staffId) {
  if (!p) return `Staff #${staffId} (1)`;
  const name = String(p.name || "").trim() || `Staff ${p.id}`;
  const cap = Math.max(1, Math.floor(Number(p.capacity)) || 1);
  return `${name} (${cap})`;
}

/**
 * @param {{ blocks: { shift_date: string, clinic: string, slots: { slot_index: number, staff_id: number | null }[] }[] }} payload
 * @param {{ id: number, name?: string, capacity?: number }[]} staffList
 * @returns {Record<string, string>} selectedReceptionistByBlock-shaped map
 */
export function receptionistSelectionMapFromApiPayload(payload, staffList) {
  const staffById = new Map((Array.isArray(staffList) ? staffList : []).map((s) => [Number(s.id), s]));
  const out = {};
  for (const block of payload?.blocks ?? []) {
    const date = String(block.shift_date ?? "").trim();
    const clinic = String(block.clinic ?? "").trim();
    if (!date) continue;
    const key = `${date}\0${clinic}`;
    const slots = [...(block.slots ?? [])].sort((a, b) => Number(a.slot_index) - Number(b.slot_index));
    const parts = [];
    for (const sl of slots) {
      if (sl.staff_id == null || sl.staff_id === "") continue;
      const sid = Number(sl.staff_id);
      const p = staffById.get(sid);
      parts.push(contributionLabelFromStaff(p, sid));
    }
    if (parts.length) out[key] = parts.join(" + ");
  }
  return out;
}

/**
 * Replace rota receptionist keys that fall in [startISO, endISO] with loadedMap; keep other weeks' keys.
 */
export function mergeReceptionistStateForDateRange(prev, loadedMap, startISO, endISO) {
  const next = { ...prev };
  for (const k of Object.keys(next)) {
    const iso = k.split("\0")[0];
    if (iso >= startISO && iso <= endISO) delete next[k];
  }
  return { ...next, ...loadedMap };
}
