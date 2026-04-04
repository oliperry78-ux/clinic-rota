import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";
import { configureBiweekWeek1Anchor, getBiweekWeek1AnchorMondayIso } from "./biweekAnchor.js";

const BiweekAnchorContext = createContext(null);

/** Dev-only scratch for preview without API; never read in production builds. */
const LS_BIWEEK_ANCHOR_DEV = "clinicRotaBiweekWeek1AnchorDate_dev";

function readAnchorFromLocalStorageDev() {
  if (!import.meta.env.DEV) return null;
  const raw = localStorage.getItem(LS_BIWEEK_ANCHOR_DEV);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function BiweekAnchorProvider({ children }) {
  const [anchorIso, setAnchorIso] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await api.getSettings();
      const iso = s.biweekWeek1AnchorDate;
      configureBiweekWeek1Anchor(iso);
      setAnchorIso(iso);
    } catch (e) {
      if (e.isHtmlResponse) {
        configureBiweekWeek1Anchor("2000-01-03");
        setAnchorIso("2000-01-03");
        if (import.meta.env.DEV) {
          const fromLs = readAnchorFromLocalStorageDev();
          if (fromLs) {
            configureBiweekWeek1Anchor(fromLs);
            setAnchorIso(fromLs);
            setLoadError(
              "Dev only: /api/settings returned HTML (API not reached). Using last browser-only draft — not shared. Start API on :3001 and use Vite dev/preview proxy."
            );
          } else {
            setLoadError(
              "Dev: /api/settings returned HTML. Start the API on port 3001; use npm run dev or vite preview with proxy (see vite.config.js)."
            );
          }
        } else {
          setLoadError(
            "Settings API unreachable (got HTML instead of JSON). Build the client with VITE_API_URL pointing at your Node API. On the database, run server/sql/add_app_settings.sql once (Supabase SQL editor or psql) so /api/settings can persist the anchor."
          );
        }
        return;
      }
      setLoadError(e.message);
      configureBiweekWeek1Anchor("2000-01-03");
      setAnchorIso("2000-01-03");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <BiweekAnchorContext.Provider value={{ anchorIso, reload, loadError }}>{children}</BiweekAnchorContext.Provider>
  );
}

export function useBiweekAnchor() {
  const ctx = useContext(BiweekAnchorContext);
  if (!ctx) throw new Error("useBiweekAnchor must be used within BiweekAnchorProvider");
  return ctx;
}

/** Header strip: editable “Week 1 starts” date (normalized to UTC Monday on save). */
export function BiweekAnchorBar() {
  const { anchorIso, reload, loadError } = useBiweekAnchor();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (anchorIso) setDraft(anchorIso);
  }, [anchorIso]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await api.putSettings({ biweekWeek1AnchorDate: draft });
      configureBiweekWeek1Anchor(r.biweekWeek1AnchorDate);
      setDraft(r.biweekWeek1AnchorDate);
      await reload();
    } catch (e) {
      if (e.isHtmlResponse) {
        if (import.meta.env.DEV) {
          configureBiweekWeek1Anchor(draft);
          const iso = getBiweekWeek1AnchorMondayIso();
          try {
            localStorage.setItem(LS_BIWEEK_ANCHOR_DEV, iso);
          } catch {
            /* ignore */
          }
          setDraft(iso);
          setSaveError("Dev only: stored in this browser; the API did not save — not shared.");
          await reload();
        } else {
          setSaveError(
            "Could not save (got HTML instead of JSON). Set VITE_API_URL at build time and ensure the API is deployed; run server/sql/add_app_settings.sql on the database."
          );
        }
      } else {
        setSaveError(e.message || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="biweek-anchor-bar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.4rem",
        fontSize: "0.8rem",
        color: "var(--muted)",
        marginBottom: "0.5rem",
      }}
    >
      <span>
        <strong style={{ color: "var(--text)" }}>Week 1 starts</strong> (UTC Monday):
      </span>
      <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ font: "inherit" }} />
      <button type="button" onClick={() => void save()} disabled={saving || !draft}>
        Save
      </button>
      {anchorIso ? (
        <span title="Weeks are counted in UTC from this Monday; any chosen date is snapped to that week’s Monday.">
          Using <code style={{ fontSize: "0.78rem" }}>{anchorIso}</code>
        </span>
      ) : null}
      {loadError ? <span style={{ color: "#b91c1c" }}>{loadError}</span> : null}
      {saveError ? <span style={{ color: "#b91c1c" }}>{saveError}</span> : null}
    </div>
  );
}
