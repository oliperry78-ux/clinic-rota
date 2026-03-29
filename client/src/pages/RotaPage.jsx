import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { computeClinicDaySummary, formatRequiredCapacity } from "../clinicDay.js";
import { computeCopyForwardAssignments } from "../rotaCopyForward.js";
import { generateReceptionistCombinations } from "../receptionistCombinations.js";
import { eligibleAssistantsForSession, eligibleReceptionistsForBlock } from "../rotaEligibility.js";
import { toISODate, weekDaysISO, weekRangeFromAnyDate, WEEKDAY_LABELS } from "../dates.js";

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Position floating popup to the right of the anchor element (Edit button), top-aligned. */
function computePopupFixedPos(anchorEl) {
  if (!anchorEl) return null;
  const rect = anchorEl.getBoundingClientRect();
  const width = 300;
  const gap = 10;
  let left = rect.right + gap;
  if (left + width > window.innerWidth - 8) {
    left = rect.left - width - gap;
  }
  if (left < 8) left = 8;
  let top = rect.top;
  const maxH = 320;
  if (top + maxH > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - 8 - maxH);
  }
  if (top < 8) top = 8;
  return { top, left, width };
}

/** Unique per rendered assistant Edit (day + clinic + shift + row index) so getElementById never returns the wrong node. */
function assistantEditAnchorId(iso, clinicName, sessionId, sessionIndex) {
  const enc = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `rota-assistant-edit-${enc(iso)}_${enc(clinicName)}_${enc(sessionId)}_row${sessionIndex}`;
}

export default function RotaPage() {
  const today = toISODate(new Date());
  const [weekAnchor, setWeekAnchor] = useState(today);
  const { startISO, endISO } = weekRangeFromAnyDate(weekAnchor);
  const days = weekDaysISO(startISO);

  const [staff, setStaff] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [error, setError] = useState(null);
  const [selectedReceptionistByBlock, setSelectedReceptionistByBlock] = useState({});
  const [assignedAssistantBySession, setAssignedAssistantBySession] = useState({});
  const [activePopup, setActivePopup] = useState(null);
  const [popupFixedPos, setPopupFixedPos] = useState(null);
  const [copyForwardBusy, setCopyForwardBusy] = useState(false);
  const [copyForwardFreq, setCopyForwardFreq] = useState("");
  const popupRef = useRef(null);
  const popupAnchorEditRef = useRef(null);

  async function loadAll() {
    setError(null);
    try {
      const [sList, shList] = await Promise.all([api.getStaff(), api.getShifts(startISO, endISO)]);
      setStaff(sList);
      setShifts(shList);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startISO, endISO]);

  useEffect(() => {
    setActivePopup(null);
    popupAnchorEditRef.current = null;
    setPopupFixedPos(null);
    setCopyForwardFreq("");
  }, [startISO, endISO]);

  useEffect(() => {
    if (!activePopup) {
      popupAnchorEditRef.current = null;
      setPopupFixedPos(null);
      return;
    }
    function syncPopupToAnchor() {
      let anchor = null;
      if (activePopup.type === "assistant" && activePopup.sessionId != null) {
        const byStoredId =
          activePopup.assistantAnchorId && document.getElementById(activePopup.assistantAnchorId);
        anchor =
          byStoredId ??
          document.getElementById(
            assistantEditAnchorId(
              activePopup.iso,
              activePopup.clinicName,
              activePopup.sessionId,
              activePopup.assistantSessionRowIndex ?? 0,
            ),
          ) ??
          popupAnchorEditRef.current;
      } else {
        anchor = popupAnchorEditRef.current;
      }
      if (!anchor) return;
      const next = computePopupFixedPos(anchor);
      if (next) {
        if (activePopup.type === "assistant") {
          console.log("[assistant popup anchor]", {
            clickedSessionId: activePopup.sessionId,
            resolvedAnchorId: anchor.id || "(no id)",
            popupTop: next.top,
            popupLeft: next.left,
          });
        }
        setPopupFixedPos(next);
      }
    }
    syncPopupToAnchor();
    window.addEventListener("scroll", syncPopupToAnchor, true);
    window.addEventListener("resize", syncPopupToAnchor);
    return () => {
      window.removeEventListener("scroll", syncPopupToAnchor, true);
      window.removeEventListener("resize", syncPopupToAnchor);
    };
  }, [activePopup]);

  useEffect(() => {
    function onMouseDown(ev) {
      if (!activePopup) return;
      const target = ev.target;
      if (popupRef.current && popupRef.current.contains(target)) return;
      if (target?.closest?.('[data-popup-trigger="true"]')) return;
      setActivePopup(null);
      popupAnchorEditRef.current = null;
      setPopupFixedPos(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [activePopup]);

  const staffById = useMemo(() => {
    const m = new Map();
    for (const s of staff) m.set(Number(s.id), s);
    return m;
  }, [staff]);

  const byDateAndClinic = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, new Map()]));
    for (const s of shifts) {
      if (!m[s.shift_date]) continue;
      const c = String(s.clinic || "").trim();
      if (!m[s.shift_date].has(c)) m[s.shift_date].set(c, []);
      m[s.shift_date].get(c).push(s);
    }
    for (const d of days) {
      for (const list of m[d].values()) {
        list.sort(
          (a, b) =>
            a.start_time.localeCompare(b.start_time) ||
            String(a.room || "").localeCompare(String(b.room || "")) ||
            String(a.doctor || "").localeCompare(String(b.doctor || ""))
        );
      }
    }
    return m;
  }, [shifts, days]);

  const clinics = useMemo(() => {
    const set = new Set();
    for (const d of days) {
      for (const clinicName of byDateAndClinic[d].keys()) set.add(clinicName);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [byDateAndClinic, days]);

  const combinationCache = useMemo(() => {
    const blocks = [];
    const byKey = new Map();
    const cache = new Map();
    for (const iso of days) {
      const clinicMap = byDateAndClinic[iso];
      for (const [clinicName, sessions] of clinicMap.entries()) {
        const summary = computeClinicDaySummary(sessions);
        const K = summary.required_capacity;
        const baseEligible = eligibleReceptionistsForBlock(
          staff,
          clinicName,
          iso,
          summary.required_start,
          summary.required_end
        ).map((p) => ({
          id: p.id,
          name: p.name,
          capacity: p.capacity ?? 1,
          staff_type: p.staff_type ?? "Full time",
        }));
        const baseCombos = generateReceptionistCombinations(baseEligible, K);
        const key = `${iso}\0${clinicName}`;
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
  }, [staff, days, byDateAndClinic, selectedReceptionistByBlock]);

  const shiftsWithLocalAssignments = useMemo(
    () =>
      shifts.map((s) => ({
        ...s,
        assigned_staff_id:
          assignedAssistantBySession[s.id] !== undefined ? assignedAssistantBySession[s.id] : s.assigned_staff_id,
      })),
    [shifts, assignedAssistantBySession]
  );

  const assistantEligibilityCache = useMemo(() => {
    const cache = new Map();
    for (const s of shiftsWithLocalAssignments) {
      const eligible = eligibleAssistantsForSession(staff, shiftsWithLocalAssignments, s);
      cache.set(s.id, eligible);
    }
    return cache;
  }, [staff, shiftsWithLocalAssignments]);

  function blockKeyFor(isoDate, clinicName) {
    return `${isoDate}\0${clinicName}`;
  }

  function getAssignedAssistantId(session) {
    if (assignedAssistantBySession[session.id] !== undefined) return assignedAssistantBySession[session.id];
    return session.assigned_staff_id ?? null;
  }

  function selectReceptionistCombo(isoDate, clinicName, comboLabel) {
    const key = blockKeyFor(isoDate, clinicName);
    setSelectedReceptionistByBlock((prev) => ({ ...prev, [key]: comboLabel }));
  }

  function clearReceptionistCombo(isoDate, clinicName) {
    const key = blockKeyFor(isoDate, clinicName);
    setSelectedReceptionistByBlock((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function assignAssistant(sessionId, staffId) {
    setAssignedAssistantBySession((prev) => ({ ...prev, [sessionId]: staffId }));
  }

  function unassignAssistant(sessionId) {
    setAssignedAssistantBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }

  async function runCopyForward(mode) {
    console.log("[copy-forward] RotaPage invoking copy", { mode });
    setCopyForwardBusy(true);
    setError(null);
    try {
      const { receptionist, assistants } = await computeCopyForwardAssignments({
        api,
        staff,
        sourceStartISO: startISO,
        sourceEndISO: endISO,
        sourceDays: days,
        sourceByDateAndClinic: byDateAndClinic,
        selectedReceptionistByBlock,
        assignedAssistantBySession,
        getShiftAssignedAssistantId: getAssignedAssistantId,
        mode,
      });
      const rxKeys = Object.keys(receptionist);
      const asKeys = Object.keys(assistants).map(Number);
      console.log("[copy-forward] RotaPage merging state", {
        receptionistKeys: rxKeys.length,
        assistantSessionIds: asKeys.length,
      });
      setSelectedReceptionistByBlock((prev) => ({ ...prev, ...receptionist }));
      setAssignedAssistantBySession((prev) => ({ ...prev, ...assistants }));
      setCopyForwardFreq("");
      console.log("[copy-forward] RotaPage setState dispatched");
    } catch (e) {
      console.warn("[copy-forward] error", e);
      setError(e.message);
    } finally {
      setCopyForwardBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      <section className="rota-page-section">
        <h2 className="rota-page-title">Rota (weekly)</h2>
        <div className="week-toolbar rota-week-toolbar">
          <label>
            Week containing{" "}
            <input type="date" value={weekAnchor} onChange={(e) => setWeekAnchor(e.target.value)} />
          </label>
          <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {startISO} → {endISO}
          </span>
          <div>
            <label>Copy this week forward</label>
            <select
              value={copyForwardFreq}
              disabled={copyForwardBusy}
              onChange={(e) => {
                const v = e.target.value;
                setCopyForwardFreq(v);
                if (v === "weekly" || v === "biweekly") void runCopyForward(v);
              }}
            >
              <option value="">Choose…</option>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every other week</option>
            </select>
          </div>
          {copyForwardBusy && (
            <span className="meta" style={{ fontSize: "0.85rem" }}>
              Copying…
            </span>
          )}
        </div>

        <div className="rota-grid-wrap">
          <div
            className="rota-grid"
            style={{ gridTemplateColumns: `100px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div className="rota-grid-header-corner">Clinic</div>
            {days.map((iso, idx) => (
              <div key={iso} className="rota-grid-header-day">
                {WEEKDAY_LABELS[idx]} · {iso}
              </div>
            ))}

            {clinics.map((clinicName) => (
              <div key={`row-${clinicName}`} className="rota-grid-row">
                <div className="rota-grid-clinic">{clinicName || "(no clinic)"}</div>
                {days.map((iso) => {
                  const sessions = byDateAndClinic[iso].get(clinicName) ?? [];
                  const key = blockKeyFor(iso, clinicName);
                  const { summary, combos } = combinationCache.get(key) ?? {
                    summary: computeClinicDaySummary([]),
                    combos: [],
                  };
                  const selectedComboLabel = selectedReceptionistByBlock[key] ?? null;

                  return (
                    <div key={`${iso}\0${clinicName}`} className="rota-grid-cell">
                      {sessions.length === 0 ? (
                        <div className="rota-empty-cell">No sessions</div>
                      ) : (
                        <>
                          <div className="rota-cell-line rota-cell-window">
                            <span className="rota-label">Window:</span> {summary.clinic_start ?? "—"}–{summary.clinic_end ?? "—"}
                          </div>
                          <div className="rota-cell-line rota-cell-receptionist">
                            <span className="rota-label">Receptionist:</span>{" "}
                            {selectedComboLabel ? selectedComboLabel : "Unassigned"}{" "}
                            <button
                              type="button"
                              className="rota-edit-link"
                              data-popup-trigger="true"
                              onClick={(e) => {
                                const btn = e.currentTarget;
                                popupAnchorEditRef.current = btn;
                                const pos = computePopupFixedPos(btn);
                                if (pos) setPopupFixedPos(pos);
                                setActivePopup({ type: "receptionist", iso, clinicName });
                              }}
                            >
                              [Edit]
                            </button>
                          </div>

                          <div className="rota-sessions-flat">
                            {sessions.map((s, sessIdx) => {
                              const assignedId = getAssignedAssistantId(s);
                              const assigned = assignedId ? staffById.get(Number(assignedId)) : null;
                              const roomBit = String(s.room || "").trim();
                              return (
                                <div key={s.id} className="rota-session-block">
                                  <div className="rota-cell-line rota-session-heading">
                                    {sessIdx + 1}) {s.start_time}–{s.end_time}
                                    {roomBit ? ` · ${roomBit}` : ""}
                                  </div>
                                  <div className="rota-cell-line rota-session-indent">
                                    Doctor: {String(s.doctor || "").trim() || "—"}
                                  </div>
                                  <div className="rota-cell-line rota-session-indent">
                                    Assistant: {assigned?.name ?? "Unassigned"}{" "}
                                    <button
                                      type="button"
                                      className="rota-edit-link"
                                      data-popup-trigger="true"
                                      id={assistantEditAnchorId(iso, clinicName, s.id, sessIdx)}
                                      onClick={(e) => {
                                        const btn = e.currentTarget;
                                        const resolvedAnchorId = btn.id;
                                        popupAnchorEditRef.current = btn;
                                        const pos = computePopupFixedPos(btn);
                                        if (pos) setPopupFixedPos(pos);
                                        setActivePopup({
                                          type: "assistant",
                                          sessionId: s.id,
                                          iso,
                                          clinicName,
                                          assistantAnchorId: resolvedAnchorId,
                                          assistantSessionRowIndex: sessIdx,
                                        });
                                      }}
                                    >
                                      [Edit]
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {activePopup &&
          popupFixedPos &&
          (() => {
            const style = { top: popupFixedPos.top, left: popupFixedPos.left, width: popupFixedPos.width };
            if (activePopup.type === "receptionist") {
              const rk = blockKeyFor(activePopup.iso, activePopup.clinicName);
              const { summary, combos } = combinationCache.get(rk) ?? {
                summary: computeClinicDaySummary([]),
                combos: [],
              };
              const selectedComboLabel = selectedReceptionistByBlock[rk] ?? null;
              const iso = activePopup.iso;
              const clinicName = activePopup.clinicName;
              return (
                <div ref={popupRef} className="rota-popup" style={style}>
                  <div className="rota-popup-head">
                    <strong>Receptionist options</strong>
                    <button
                      type="button"
                      className="secondary rota-close-btn"
                      onClick={() => {
                        setActivePopup(null);
                        popupAnchorEditRef.current = null;
                        setPopupFixedPos(null);
                      }}
                    >
                      X
                    </button>
                  </div>
                  <div className="meta" style={{ fontSize: "0.75rem", marginBottom: "0.35rem" }}>
                    Required capacity: {formatRequiredCapacity(summary.required_capacity)}
                  </div>
                  {summary.required_capacity <= 0 ? (
                    <p className="meta" style={{ margin: 0, fontSize: "0.75rem" }}>
                      No capacity required.
                    </p>
                  ) : combos.length === 0 ? (
                    <p className="meta" style={{ margin: 0, fontSize: "0.75rem" }}>
                      No valid combination.
                    </p>
                  ) : (
                    (() => {
                      const byTier = { 1: [], 2: [], 3: [] };
                      for (const c of combos) {
                        const tier = c.priorityTier ?? 3;
                        byTier[tier].push(c);
                      }
                      const tiersInUse = [1, 2, 3].filter((t) => byTier[t].length > 0);
                      return (
                        <div>
                          {tiersInUse.map((t) => (
                            <div key={t} style={{ marginTop: t === 1 ? 0 : "0.35rem" }}>
                              <div className="rota-tier-heading">Priority {t}</div>
                              <ul className="rota-popup-list">
                                {byTier[t].map((c) => (
                                  <li
                                    key={c.label}
                                    className={
                                      selectedComboLabel === c.label ? "rota-popup-row rota-assigned-row" : "rota-popup-row"
                                    }
                                  >
                                    <span>{c.label}</span>
                                    {selectedComboLabel === c.label ? (
                                      <>
                                        <span className="rota-assigned-chip">Assigned</span>
                                        <button
                                          type="button"
                                          className="secondary"
                                          onClick={() => clearReceptionistCombo(iso, clinicName)}
                                        >
                                          Unassign
                                        </button>
                                      </>
                                    ) : (
                                      <button type="button" onClick={() => selectReceptionistCombo(iso, clinicName, c.label)}>
                                        Assign
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              );
            }
            const s = shiftsWithLocalAssignments.find((x) => x.id === activePopup.sessionId);
            if (!s) return null;
            return (
              <div ref={popupRef} className="rota-popup" style={style}>
                <div className="rota-popup-head">
                  <strong>Eligible doctors assistants</strong>
                  <button
                    type="button"
                    className="secondary rota-close-btn"
                    onClick={() => {
                      setActivePopup(null);
                      popupAnchorEditRef.current = null;
                      setPopupFixedPos(null);
                    }}
                  >
                    X
                  </button>
                </div>
                {(() => {
                  const eligibleAssistants = assistantEligibilityCache.get(s.id) ?? [];
                  const assignedAssistantId = getAssignedAssistantId(s);
                  const assignedAssistant = assignedAssistantId ? staffById.get(Number(assignedAssistantId)) : null;
                  const assignedIsEligible = eligibleAssistants.some((a) => Number(a.id) === Number(assignedAssistantId));
                  if (eligibleAssistants.length === 0) {
                    return (
                      <>
                        {assignedAssistant && (
                          <div className="rota-popup-row rota-assigned-row">
                            <span>{assignedAssistant.name}</span>
                            <span className="rota-assigned-chip">Assigned</span>
                            <button type="button" className="secondary" onClick={() => unassignAssistant(s.id)}>
                              Unassign
                            </button>
                          </div>
                        )}
                        <p className="meta" style={{ margin: 0, fontSize: "0.75rem" }}>
                          None match current constraints.
                        </p>
                      </>
                    );
                  }
                  return (
                    <div>
                      {assignedAssistant && !assignedIsEligible && (
                        <div className="rota-popup-row rota-assigned-row">
                          <span>{assignedAssistant.name}</span>
                          <span className="rota-assigned-chip">Assigned</span>
                          <button type="button" className="secondary" onClick={() => unassignAssistant(s.id)}>
                            Unassign
                          </button>
                        </div>
                      )}
                      <ul className="rota-popup-list">
                        {eligibleAssistants.map((a) => (
                          <li
                            key={a.id}
                            className={
                              Number(assignedAssistantId) === Number(a.id)
                                ? "rota-popup-row rota-assigned-row"
                                : "rota-popup-row"
                            }
                          >
                            <span>{a.name}</span>
                            {Number(assignedAssistantId) === Number(a.id) ? (
                              <>
                                <span className="rota-assigned-chip">Assigned</span>
                                <button type="button" className="secondary" onClick={() => unassignAssistant(s.id)}>
                                  Unassign
                                </button>
                              </>
                            ) : (
                              <button type="button" onClick={() => assignAssistant(s.id, a.id)}>
                                Assign
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
      </section>
    </div>
  );
}
