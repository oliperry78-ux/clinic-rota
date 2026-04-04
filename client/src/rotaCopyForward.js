/**
 * Copy rota assignments from a visible week to matching future sessions / clinic-day blocks.
 * Does not create sessions; only maps onto existing future rows and respects eligibility rules.
 */

import { addDaysToISO, mondayOfWeek, parseISODate, toISODate, weekDaysISO } from "./dates.js";
import { computeClinicDaySummary } from "./clinicDay.js";
import { generateReceptionistCombinations } from "./receptionistCombinations.js";
import { eligibleReceptionistsForBlock, eligibleAssistantsForSession } from "./rotaEligibility.js";

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function localDowMon0(iso) {
  const d = parseISODate(iso);
  const js = d.getDay();
  return js === 0 ? 6 : js - 1;
}

function isoWeekMonday(iso) {
  return toISODate(mondayOfWeek(iso));
}

function weeksAfterSourceMonday(sourceMondayISO, targetISO) {
  const mTarget = isoWeekMonday(targetISO);
  const t0 = parseISODate(sourceMondayISO).getTime();
  const t1 = parseISODate(mTarget).getTime();
  const diffDays = Math.round((t1 - t0) / 86400000);
  return diffDays / 7;
}

function shouldCopyToWeek(weeksOffset, mode) {
  if (weeksOffset < 1) return false;
  if (mode === "weekly") return true;
  return weeksOffset >= 2 && weeksOffset % 2 === 0;
}

function blockKeyFor(isoDate, clinicName) {
  return `${isoDate}\0${clinicName}`;
}

/** Recover staff ids from a combo label when the combo is no longer in the generated list (still persisted). */
export function parseReceptionistLabelToStaffIds(label, staffList) {
  if (!label || !staffList?.length) return null;
  const segments = String(label)
    .split(" + ")
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const seg of segments) {
    const m = seg.match(/^(.+)\s+\((\d+)\)\s*$/);
    if (!m) return null;
    const name = m[1].trim();
    const cap = Math.max(1, parseInt(m[2], 10) || 1);
    const candidates = staffList.filter(
      (p) => String(p.name || "").trim() === name && Math.max(1, Math.floor(Number(p.capacity)) || 1) === cap
    );
    if (!candidates.length) return null;
    out.push(Number(candidates[0].id));
  }
  return out.length ? out : null;
}

function buildCombinationCacheForWeek(staff, days, byDateAndClinic, selectedReceptionistByBlock, dateOverrides) {
  const blocks = [];
  const byKey = new Map();
  const cache = new Map();
  const overrides = Array.isArray(dateOverrides) ? dateOverrides : [];
  for (const iso of days) {
    const clinicMap = byDateAndClinic[iso];
    if (!clinicMap) continue;
    for (const [clinicName, sessions] of clinicMap.entries()) {
      const summary = computeClinicDaySummary(sessions);
      const K = summary.required_capacity;
      const baseEligible = eligibleReceptionistsForBlock(
        staff,
        clinicName,
        iso,
        summary.required_start,
        summary.required_end,
        overrides
      ).map((p) => ({
        id: p.id,
        name: p.name,
        capacity: p.capacity ?? 1,
        staff_type: p.staff_type ?? "Full time",
      }));
      const baseCombos = generateReceptionistCombinations(baseEligible, K);
      const key = blockKeyFor(iso, clinicName);
      const block = { key, iso, clinicName, summary, requiredCapacity: K, baseEligible, baseCombos };
      blocks.push(block);
      byKey.set(key, block);
    }
  }

  function blocksOverlap(a, b) {
    if (a.iso !== b.iso) return false;
    if (!a.summary.required_start || !a.summary.required_end) return false;
    if (!b.summary.required_start || !b.summary.required_end) return false;
    return rangesOverlap(
      timeToMinutes(a.summary.required_start),
      timeToMinutes(a.summary.required_end),
      timeToMinutes(b.summary.required_start),
      timeToMinutes(b.summary.required_end)
    );
  }

  const selectedByBlock = new Map();
  for (const [key, label] of Object.entries(selectedReceptionistByBlock)) {
    const block = byKey.get(key);
    if (!block) continue;
    const selectedCombo = block.baseCombos.find((c) => c.label === label);
    if (!selectedCombo) continue;
    selectedByBlock.set(key, selectedCombo);
  }

  for (const block of blocks) {
    const blockedStaffIds = new Set();
    for (const [otherKey, selectedCombo] of selectedByBlock.entries()) {
      if (otherKey === block.key) continue;
      const otherBlock = byKey.get(otherKey);
      if (!otherBlock) continue;
      if (!blocksOverlap(block, otherBlock)) continue;
      for (const c of selectedCombo.contributions ?? []) blockedStaffIds.add(Number(c.staffId));
    }

    const eligible = block.baseEligible.filter((p) => !blockedStaffIds.has(Number(p.id)));
    const recomputedCombos = generateReceptionistCombinations(eligible, block.requiredCapacity);
    const selectedCombo = selectedByBlock.get(block.key);
    const combos = selectedCombo
      ? [selectedCombo, ...recomputedCombos.filter((c) => c.label !== selectedCombo.label)]
      : recomputedCombos;

    cache.set(block.key, { eligible, combos, summary: block.summary });
  }

  return cache;
}

function dayReceptionistSelectionsAllValid(staff, iso, byDateAndClinic, daySelections, dateOverrides) {
  const clinicMap = byDateAndClinic[iso];
  if (!clinicMap) return Object.keys(daySelections).length === 0;
  const cache = buildCombinationCacheForWeek(staff, [iso], { [iso]: clinicMap }, daySelections, dateOverrides);
  for (const [key, label] of Object.entries(daySelections)) {
    if (!key.startsWith(`${iso}\0`)) continue;
    const entry = cache.get(key);
    if (!entry) return false;
    if (!label) continue;
    if (!entry.combos.some((c) => c.label === label)) return false;
  }
  return true;
}

function groupShiftsByDate(shifts) {
  const m = {};
  for (const s of shifts) {
    const iso = String(s.shift_date);
    if (!m[iso]) m[iso] = [];
    m[iso].push(s);
  }
  for (const iso of Object.keys(m)) {
    const clinicMap = new Map();
    for (const sh of m[iso]) {
      // Must match RotaPage byDateAndClinic (empty clinic → ""), not "(no clinic)"
      const c = String(sh.clinic || "").trim();
      if (!clinicMap.has(c)) clinicMap.set(c, []);
      clinicMap.get(c).push(sh);
    }
    for (const list of clinicMap.values()) {
      list.sort(
        (a, b) =>
          a.start_time.localeCompare(b.start_time) ||
          String(a.room || "").localeCompare(String(b.room || "")) ||
          String(a.doctor || "").localeCompare(String(b.doctor || ""))
      );
    }
    m[iso] = clinicMap;
  }
  return m;
}

/**
 * @param {object} params
 * @param {"weekly"|"biweekly"} params.mode
 * @returns {Promise<{ receptionist: Record<string,string>, receptionistSlots: Record<string, number[]>, receptionistSlotManualOverrides: Record<string, boolean[]>, assistants: Record<number,number> }>}
 */
export async function computeCopyForwardAssignments({
  api,
  staff,
  sourceStartISO,
  sourceEndISO,
  sourceDays,
  sourceByDateAndClinic,
  selectedReceptionistByBlock,
  receptionistManualOverrideByBlock = {},
  getShiftAssignedAssistantId,
  mode,
  horizonDays = 800,
  dateOverrides = [],
}) {
  const futureStart = addDaysToISO(sourceEndISO, 1);
  const futureEnd = addDaysToISO(sourceEndISO, horizonDays);
  console.log("[copy-forward] run", { mode, sourceStartISO, sourceEndISO, futureStart, futureEnd });
  const allFuture = await api.getShifts(futureStart, futureEnd);
  console.log("[copy-forward] future shifts loaded", { count: allFuture.length });

  const sourceCache = buildCombinationCacheForWeek(
    staff,
    sourceDays,
    sourceByDateAndClinic,
    selectedReceptionistByBlock,
    dateOverrides
  );

  const receptionistUpdates = {};
  const receptionistSlotUpdates = {};
  const receptionistSlotManualOverrides = {};
  const assistantsUpdates = {};

  const rxTemplates = [];
  const asTemplates = [];

  for (const iso of sourceDays) {
    const clinicMap = sourceByDateAndClinic[iso];
    if (!clinicMap) continue;
    const dow = localDowMon0(iso);
    for (const [clinicName, sessions] of clinicMap.entries()) {
      const summary = computeClinicDaySummary(sessions);
      const key = blockKeyFor(iso, clinicName);
      const label = selectedReceptionistByBlock[key];
      if (label && summary.required_capacity > 0 && summary.clinic_start && summary.clinic_end) {
        const cacheEntry = sourceCache.get(key);
        const combo = cacheEntry?.combos.find((c) => c.label === label);
        const staffIds = combo
          ? combo.contributions.map((x) => Number(x.staffId))
          : parseReceptionistLabelToStaffIds(label, staff);
        if (staffIds?.length) {
          const manualBlock = Boolean(receptionistManualOverrideByBlock[key]);
          rxTemplates.push({
            weekdayMon0: dow,
            clinic: clinicName,
            clinic_start: summary.clinic_start,
            clinic_end: summary.clinic_end,
            required_capacity: summary.required_capacity,
            label,
            staffIds,
            manualOverrides: staffIds.map(() => manualBlock),
          });
        }
      }
      for (const s of sessions) {
        const aid = getShiftAssignedAssistantId(s);
        if (aid != null && aid !== "" && Number.isFinite(Number(aid)) && Number(aid) > 0) {
          asTemplates.push({
            weekdayMon0: dow,
            clinic: String(s.clinic || "").trim(),
            room: String(s.room || "").trim(),
            doctor: String(s.doctor || "").trim(),
            start_time: s.start_time,
            end_time: s.end_time,
            assistantId: Number(aid),
          });
        }
      }
    }
  }

  if (rxTemplates.length === 0 && asTemplates.length === 0) {
    console.log("[copy-forward] no source templates (nothing to copy)");
    return {
      receptionist: receptionistUpdates,
      receptionistSlots: receptionistSlotUpdates,
      receptionistSlotManualOverrides,
      assistants: assistantsUpdates,
    };
  }

  console.log("[copy-forward] source templates", { receptionistBlocks: rxTemplates.length, sessionsWithAssistant: asTemplates.length });

  const futureByDate = groupShiftsByDate(allFuture);

  const rxCandidates = [];
  const asCandidates = [];

  for (const iso of Object.keys(futureByDate).sort()) {
    const wk = weeksAfterSourceMonday(sourceStartISO, iso);
    if (!shouldCopyToWeek(wk, mode)) continue;

    const clinicMap = futureByDate[iso];
    for (const [clinicName, sessions] of clinicMap.entries()) {
      const summary = computeClinicDaySummary(sessions);
      const dow = localDowMon0(iso);
      const tmpl = rxTemplates.find(
        (t) =>
          t.weekdayMon0 === dow &&
          t.clinic === clinicName &&
          t.clinic_start === summary.clinic_start &&
          t.clinic_end === summary.clinic_end &&
          t.required_capacity === summary.required_capacity
      );
      if (tmpl) {
        rxCandidates.push({
          key: blockKeyFor(iso, clinicName),
          label: tmpl.label,
          staffIds: tmpl.staffIds,
          manualOverrides: tmpl.manualOverrides,
          iso,
        });
      }
      for (const s of sessions) {
        const dowS = localDowMon0(iso);
        const st = asTemplates.find(
          (t) =>
            t.weekdayMon0 === dowS &&
            t.clinic === String(s.clinic || "").trim() &&
            t.room === String(s.room || "").trim() &&
            t.doctor === String(s.doctor || "").trim() &&
            t.start_time === s.start_time &&
            t.end_time === s.end_time
        );
        if (st) {
          asCandidates.push({ session: s, assistantId: st.assistantId });
        }
      }
    }
  }

  console.log("[copy-forward] future matches (before validity)", {
    receptionistTargets: rxCandidates.length,
    assistantTargets: asCandidates.length,
  });

  const weekBuckets = new Map();

  function addToWeek(iso, fn) {
    const mon = isoWeekMonday(iso);
    if (!weekBuckets.has(mon)) weekBuckets.set(mon, { shifts: [], rxCand: [], asCand: [] });
    fn(weekBuckets.get(mon));
  }

  for (const s of allFuture) {
    const iso = String(s.shift_date);
    const wk = weeksAfterSourceMonday(sourceStartISO, iso);
    if (!shouldCopyToWeek(wk, mode)) continue;
    addToWeek(iso, (b) => b.shifts.push(s));
  }

  for (const c of rxCandidates) {
    addToWeek(c.iso, (b) => b.rxCand.push(c));
  }
  for (const c of asCandidates) {
    const iso = String(c.session.shift_date);
    addToWeek(iso, (b) => b.asCand.push(c));
  }

  const sortedWeekMons = [...weekBuckets.keys()].sort();

  for (const weekMon of sortedWeekMons) {
    const bucket = weekBuckets.get(weekMon);
    const days = weekDaysISO(weekMon);
    const byDate = {};
    for (const d of days) {
      byDate[d] = futureByDate[d] ?? new Map();
    }

    const rxSorted = [...bucket.rxCand].sort((a, b) => a.key.localeCompare(b.key));
    const rxWorking = {};
    for (const d of days) {
      for (const [k, v] of Object.entries(selectedReceptionistByBlock)) {
        if (k.startsWith(`${d}\0`)) rxWorking[k] = v;
      }
    }

    for (const c of rxSorted) {
      const daySel = {};
      for (const [k, v] of Object.entries(rxWorking)) {
        const isoK = k.split("\0")[0];
        if (isoK === c.iso) daySel[k] = v;
      }
      daySel[c.key] = c.label;
      if (dayReceptionistSelectionsAllValid(staff, c.iso, byDate, daySel, dateOverrides)) {
        rxWorking[c.key] = c.label;
        receptionistUpdates[c.key] = c.label;
        receptionistSlotUpdates[c.key] = c.staffIds;
        if (Array.isArray(c.manualOverrides) && c.manualOverrides.length === c.staffIds.length) {
          receptionistSlotManualOverrides[c.key] = c.manualOverrides;
        }
      }
    }

    const shiftsInWeek = bucket.shifts.slice().sort((a, b) => {
      const da = String(a.shift_date).localeCompare(String(b.shift_date));
      if (da !== 0) return da;
      return a.start_time.localeCompare(b.start_time) || a.id - b.id;
    });

    const assistWorking = {};
    function resolveAssigned(sid) {
      const sh = shiftsInWeek.find((x) => x.id === sid);
      if (!sh) return null;
      if (assistWorking[sid] !== undefined) return assistWorking[sid];
      return sh.assigned_staff_id ?? null;
    }

    const asSorted = [...bucket.asCand].sort((a, b) => {
      const d = String(a.session.shift_date).localeCompare(String(b.session.shift_date));
      if (d !== 0) return d;
      return a.session.start_time.localeCompare(b.session.start_time) || a.session.id - b.id;
    });

    for (const { session, assistantId } of asSorted) {
      const shiftsWith = shiftsInWeek.map((s) => ({
        ...s,
        assigned_staff_id: s.id === session.id ? assistantId : resolveAssigned(s.id),
      }));
      const target = shiftsWith.find((x) => x.id === session.id);
      if (!target) continue;
      const eligible = eligibleAssistantsForSession(staff, shiftsWith, target, dateOverrides);
      if (eligible.some((a) => Number(a.id) === Number(assistantId))) {
        assistWorking[session.id] = assistantId;
        assistantsUpdates[session.id] = assistantId;
      }
    }
  }

  const nRx = Object.keys(receptionistUpdates).length;
  const nAs = Object.keys(assistantsUpdates).length;
  console.log("[copy-forward] applied assignments", {
    receptionistBlocks: nRx,
    assistantSessions: nAs,
  });

  return {
    receptionist: receptionistUpdates,
    receptionistSlots: receptionistSlotUpdates,
    receptionistSlotManualOverrides,
    assistants: assistantsUpdates,
  };
}
