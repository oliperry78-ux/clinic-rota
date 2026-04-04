import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const STORAGE_KEY = "clinic_rota_v1_temp_staff_id";

const TempIsolationContext = createContext(null);

export function TempIsolationProvider({ children }) {
  const [lockedStaffId, setLockedStaffId] = useState(null);
  /** True while a ?v=1 temp URL is loading; hides chrome before lock is written. */
  const [tempV1LinkPending, setTempV1LinkPending] = useState(false);

  useEffect(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY);
      if (v && /^\d+$/.test(v)) setLockedStaffId(v);
    } catch {
      /* private mode */
    }
  }, []);

  const activateTempIsolation = useCallback((staffId) => {
    const s = String(staffId ?? "").trim();
    if (!/^\d+$/.test(s)) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
    setLockedStaffId(s);
  }, []);

  const clearTempIsolation = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setLockedStaffId(null);
  }, []);

  const value = useMemo(
    () => ({
      lockedStaffId,
      activateTempIsolation,
      clearTempIsolation,
      tempV1LinkPending,
      setTempV1LinkPending,
    }),
    [lockedStaffId, activateTempIsolation, clearTempIsolation, tempV1LinkPending]
  );

  return <TempIsolationContext.Provider value={value}>{children}</TempIsolationContext.Provider>;
}

export function useTempIsolation() {
  const ctx = useContext(TempIsolationContext);
  if (!ctx) throw new Error("useTempIsolation must be used within TempIsolationProvider");
  return ctx;
}

/** When V1 temp isolation is active, keep the user on their temp calendar route only. */
export function TempIsolationRedirect() {
  const { lockedStaffId } = useTempIsolation();
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    if (!lockedStaffId) return;
    const m = loc.pathname.match(/\/temp-date-availability\/(\d+)\/?$/);
    const onAllowedPage = m && m[1] === lockedStaffId;
    if (!onAllowedPage) {
      nav(`/temp-date-availability/${lockedStaffId}?v=1`, { replace: true });
    }
  }, [lockedStaffId, loc.pathname, nav]);

  return null;
}
