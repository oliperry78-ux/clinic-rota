import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import DateAvailabilityEditor from "../components/DateAvailabilityEditor.jsx";

function tempSelfServePath(staffId) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  return `${base}/temp-date-availability/${staffId}?v=1`;
}

function tempSelfServeAbsoluteUrl(staffId) {
  return `${window.location.origin}${tempSelfServePath(staffId)}`;
}

export default function DateAvailabilityPage() {
  const [staff, setStaff] = useState([]);
  const [selectedId, setSelectedId] = useState("");
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

  const selectedStaff = useMemo(
    () => staff.find((s) => Number(s.id) === Number(selectedId)),
    [staff, selectedId]
  );

  const shareUrl = selectedId && selectedStaff?.staff_type === "Temp" ? tempSelfServeAbsoluteUrl(selectedId) : "";

  async function onCopyLink() {
    if (!shareUrl) return;
    setCopyMsg("");
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMsg("Copied.");
      window.setTimeout(() => setCopyMsg(""), 2000);
    } catch {
      setCopyMsg("Copy failed — copy from the address bar manually.");
    }
  }

  return (
    <div className="card date-availability-card">
      <DateAvailabilityEditor
        staffId={selectedId ? Number(selectedId) : null}
        intro={
          <p className="meta date-availability-intro">
            Pick a staff member, then click days to mark them as available on those dates (green). Blank days have no
            override—weekly availability still applies for permanent staff. Temp staff with no weekly pattern only appear
            when a day is marked green.
          </p>
        }
        managerToolbar={
          <>
            <label className="date-availability-staff-label">
              Staff member{" "}
              <select
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setCopyMsg("");
                }}
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
            {selectedStaff?.staff_type === "Temp" && selectedId && (
              <div
                className="temp-availability-share"
                style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
              >
                <span className="meta" style={{ fontSize: "0.82rem" }}>
                  Temp self-serve:
                </span>
                <button type="button" className="secondary" onClick={() => void onCopyLink()}>
                  Copy Link
                </button>
                {copyMsg && (
                  <span className="meta" style={{ fontSize: "0.8rem" }}>
                    {copyMsg}
                  </span>
                )}
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
