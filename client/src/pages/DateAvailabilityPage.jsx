import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { formatDateUK } from "../dates.js";
import DateAvailabilityEditor from "../components/DateAvailabilityEditor.jsx";

export default function DateAvailabilityPage() {
  const [staff, setStaff] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  // Token state for the selected staff member
  const [tokenInfo, setTokenInfo] = useState(null); // null | { token, active, lastUsedAt }
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");

  async function loadStaff() {
    try {
      const sList = await api.getStaff();
      setStaff(sList);
    } catch {
      /* editor shows errors for overrides; staff load failure is rare */
    }
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  async function loadToken(staffId) {
    setTokenLoading(true);
    setTokenError(null);
    setTokenInfo(null);
    try {
      const info = await api.getAvailabilityToken(staffId);
      setTokenInfo(info);
    } catch (e) {
      setTokenError(e.message || "Could not load link status.");
    } finally {
      setTokenLoading(false);
    }
  }

  useEffect(() => {
    setCopyMsg("");
    if (!selectedId) {
      setTokenInfo(null);
      setTokenError(null);
      return;
    }
    void loadToken(selectedId);
  }, [selectedId]);

  const selectedStaff = useMemo(
    () => staff.find((s) => Number(s.id) === Number(selectedId)),
    [staff, selectedId]
  );

  const availabilityLink =
    tokenInfo?.token && tokenInfo?.active
      ? `${window.location.origin}/availability/${tokenInfo.token}`
      : "";

  const lastUsedLabel = tokenInfo?.lastUsedAt
    ? `Last used: ${formatDateUK(tokenInfo.lastUsedAt.slice(0, 10))}`
    : "Never used";

  async function onGenerate() {
    if (!selectedId) return;
    setGenerating(true);
    setTokenError(null);
    setCopyMsg("");
    try {
      await api.generateAvailabilityToken(selectedId);
      await loadToken(selectedId);
    } catch (e) {
      setTokenError(e.message || "Could not generate link.");
    } finally {
      setGenerating(false);
    }
  }

  async function onRevoke() {
    if (!selectedId) return;
    setRevoking(true);
    setTokenError(null);
    setCopyMsg("");
    try {
      await api.revokeAvailabilityToken(selectedId);
      await loadToken(selectedId);
    } catch (e) {
      setTokenError(e.message || "Could not revoke link.");
    } finally {
      setRevoking(false);
    }
  }

  async function onCopyLink() {
    if (!availabilityLink) return;
    setCopyMsg("");
    try {
      await navigator.clipboard.writeText(availabilityLink);
      setCopyMsg("Copied.");
      window.setTimeout(() => setCopyMsg(""), 2000);
    } catch {
      setCopyMsg("Copy failed — copy the link manually.");
    }
  }

  return (
    <div className="card date-availability-card">
      <DateAvailabilityEditor
        staffId={selectedId ? Number(selectedId) : null}
        intro={
          <p className="meta date-availability-intro">
            Pick a staff member, then click days to mark them as available on those dates (green).
            Blank days have no override—weekly availability still applies for permanent staff. Temp
            staff with no weekly pattern only appear when a day is marked green.
          </p>
        }
        managerToolbar={
          <>
            <label className="date-availability-staff-label">
              Staff member{" "}
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="date-availability-select"
              >
                <option value="">Choose…</option>
                {staff.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name} ({s.role})
                  </option>
                ))}
              </select>
            </label>
            {selectedStaff != null && selectedId && (
              <div
                className="temp-availability-share"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  marginTop: "0.25rem",
                }}
              >
                {tokenLoading && (
                  <span className="meta" style={{ fontSize: "0.82rem" }}>
                    Loading link…
                  </span>
                )}
                {!tokenLoading && tokenError && (
                  <span style={{ color: "#b91c1c", fontSize: "0.82rem" }}>{tokenError}</span>
                )}
                {!tokenLoading && !tokenError && tokenInfo && !tokenInfo.active && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void onGenerate()}
                    disabled={generating}
                  >
                    {generating ? "Generating…" : "Generate link"}
                  </button>
                )}
                {!tokenLoading && !tokenError && tokenInfo?.active && (
                  <>
                    <span className="meta" style={{ fontSize: "0.82rem" }}>
                      Availability link:
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void onCopyLink()}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void onGenerate()}
                      disabled={generating}
                      title="Deactivates the current link and creates a new one"
                    >
                      {generating ? "Regenerating…" : "Regenerate"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void onRevoke()}
                      disabled={revoking}
                      title="Deactivates this link without creating a new one"
                    >
                      {revoking ? "Revoking…" : "Revoke"}
                    </button>
                    <span className="meta" style={{ fontSize: "0.8rem" }}>
                      {lastUsedLabel}
                    </span>
                    {copyMsg && (
                      <span className="meta" style={{ fontSize: "0.8rem" }}>
                        {copyMsg}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
