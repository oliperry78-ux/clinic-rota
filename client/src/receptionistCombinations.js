/**
 * All non-empty subsets of eligible receptionists whose combined fixed capacities meet the need.
 * Each person is either included at their full stored capacity or not included — no partial allocation.
 *
 * @param {{ id: number, name: string, capacity: number, staff_type?: string }[]} eligible
 * @param {number} K required_capacity (sum of included capacities must be >= K)
 * @returns {{ label: string, contributions: { staffId: number, name: string, capacity: number, staffType: string }[], totalCapacity: number }[]}
 */
export function generateReceptionistCombinations(eligible, K) {
  if (K <= 0 || !eligible.length) return [];

  function normalizeStaffType(raw) {
    const s = String(raw ?? "").trim();
    if (s === "Full time" || s === "Part time" || s === "Temp") return s;
    return "Full time";
  }

  function priorityTierFromContributions(contributions) {
    const hasTemp = contributions.some((c) => c.staffType === "Temp");
    const hasFull = contributions.some((c) => c.staffType === "Full time");
    const hasPart = contributions.some((c) => c.staffType === "Part time");
    if (hasTemp) return 3;
    if (hasFull) return 1;
    if (hasPart) return 2;
    return 2;
  }

  function staffTypeQualityVector(contributions) {
    // Used only as a final tie-breaker to preserve the existing staff-type ranking.
    let full = 0;
    let part = 0;
    let temp = 0;
    for (const c of contributions) {
      if (c.staffType === "Full time") full++;
      else if (c.staffType === "Part time") part++;
      else temp++;
    }
    return { hasTemp: temp > 0 ? 1 : 0, full, part, temp };
  }

  const staff = eligible.map((s) => ({
    id: s.id,
    name: String(s.name || "").trim() || `Staff ${s.id}`,
    cap: Math.max(1, Math.floor(Number(s.capacity)) || 1),
    staffType: normalizeStaffType(s.staff_type),
  }));

  const maxSum = staff.reduce((a, s) => a + s.cap, 0);
  if (maxSum < K) return [];

  const n = staff.length;
  const byLabel = new Map();

  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const picked = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += staff[i].cap;
        picked.push(staff[i]);
      }
    }
    if (sum < K) continue;
    picked.sort((a, b) => a.name.localeCompare(b.name));
    const contributions = picked.map((s) => ({
      staffId: s.id,
      name: s.name,
      capacity: s.cap,
      staffType: s.staffType,
    }));
    const label = contributions.map((c) => `${c.name} (${c.capacity})`).join(" + ");
    if (!byLabel.has(label)) {
      byLabel.set(label, { contributions, totalCapacity: sum });
    }
  }

  return [...byLabel.entries()]
    .map(([, row]) => {
      const tier = priorityTierFromContributions(row.contributions);
      const excess = row.totalCapacity - K;
      const staffCount = row.contributions.length;
      const q = staffTypeQualityVector(row.contributions);
      return {
        ...row,
        priorityTier: tier,
        excessCapacity: excess,
        staffCount,
        qualityVector: q,
      };
    })
    .sort((a, b) => {
      // 1) Visible tier grouping by staff-type quality:
      // Priority 1: has Full time and no Temp
      // Priority 2: no Full time, has Part time, no Temp
      // Priority 3: has Temp
      if (a.priorityTier !== b.priorityTier) return a.priorityTier - b.priorityTier;

      // 2) Within tier: least excess capacity first.
      if (a.excessCapacity !== b.excessCapacity) return a.excessCapacity - b.excessCapacity;

      // 3) If tied: fewer staff first.
      if (a.staffCount !== b.staffCount) return a.staffCount - b.staffCount;

      // 4) Final tie-break: preserve existing staff-type ranking order.
      if (a.qualityVector.hasTemp !== b.qualityVector.hasTemp) return a.qualityVector.hasTemp - b.qualityVector.hasTemp;
      if (a.qualityVector.full !== b.qualityVector.full) return b.qualityVector.full - a.qualityVector.full;
      if (a.qualityVector.part !== b.qualityVector.part) return b.qualityVector.part - a.qualityVector.part;
      if (a.qualityVector.temp !== b.qualityVector.temp) return a.qualityVector.temp - b.qualityVector.temp;

      // 5) Last resort: alphabetical (previous stable-ish behavior).
      const labelA = a.contributions.map((c) => `${c.name} (${c.capacity})`).join(" + ");
      const labelB = b.contributions.map((c) => `${c.name} (${c.capacity})`).join(" + ");
      return labelA.localeCompare(labelB);
    })
    .map((row) => ({
      label: row.contributions.map((c) => `${c.name} (${c.capacity})`).join(" + "),
      contributions: row.contributions,
      totalCapacity: row.totalCapacity,
      priorityTier: row.priorityTier,
      excessCapacity: row.excessCapacity,
      staffCount: row.staffCount,
    }));
}
