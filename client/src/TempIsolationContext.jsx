import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "clinic_rota_v1_temp_staff_id";

const TempIsolationContext = createContext(null);

export function TempIsolationProvider({ children }) {
  const [lockedStaffId, setLockedStaffId] = useState(null);

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
    }),
    [lockedStaffId, activateTempIsolation, clearTempIsolation]
  );

  return <TempIsolationContext.Provider value={value}>{children}</TempIsolationContext.Provider>;
}

export function useTempIsolation() {
  const ctx = useContext(TempIsolationContext);
  if (!ctx) throw new Error("useTempIsolation must be used within TempIsolationProvider");
  return ctx;
}

