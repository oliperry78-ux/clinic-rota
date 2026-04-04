import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import DateAvailabilityEditor from "../components/DateAvailabilityEditor.jsx";
import { useTempIsolation } from "../TempIsolationContext.jsx";

export default function TempDateAvailabilityPage() {
  const [searchParams] = useSearchParams();
  const { activateTempIsolation, clearTempIsolation, setTempV1LinkPending } = useTempIsolation();
  const { staffId: staffIdParam } = useParams();
  const id = Number(staffIdParam);
  const [member, setMember] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoadError(null);
      setLoading(true);
      if (!Number.isFinite(id) || id <= 0) {
        setLoadError("Invalid link.");
        setMember(null);
        setLoading(false);
        return;
      }
      try {
        const list = await api.getStaff();
        if (cancelled) return;
        const m = list.find((s) => Number(s.id) === id) ?? null;
        setMember(m);
        if (!m) setLoadError("Staff member not found.");
        else if (String(m.staff_type ?? "").trim() !== "Temp") {
          setLoadError("This link is only for temporary staff.");
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const v1Temp = searchParams.get("v") === "1";

  useEffect(() => {
    if (!v1Temp) return;
    setTempV1LinkPending(true);
    return () => setTempV1LinkPending(false);
  }, [v1Temp, setTempV1LinkPending]);

  useEffect(() => {
    if (loading) return;
    if (v1Temp) setTempV1LinkPending(false);
    if (!v1Temp) return;
    if (loadError || !member || String(member.staff_type ?? "").trim() !== "Temp") {
      clearTempIsolation();
      return;
    }
    activateTempIsolation(String(id));
  }, [
    loading,
    loadError,
    member,
    id,
    v1Temp,
    activateTempIsolation,
    clearTempIsolation,
    setTempV1LinkPending,
  ]);

  if (loading) {
    return (
      <div className="card date-availability-card">
        <p className="meta">Loading…</p>
      </div>
    );
  }

  if (loadError || !member || String(member.staff_type ?? "").trim() !== "Temp") {
    return (
      <div className="card date-availability-card">
        <h2>Date availability</h2>
        <p className="meta">{loadError || "Unavailable."}</p>
      </div>
    );
  }

  return (
    <div className="card date-availability-card">
      <DateAvailabilityEditor
        staffId={id}
        mainTitle="Your date availability"
        hideSelectPrompt
        staffBanner={`${member.name} — click days you are available (green), then Save.`}
        intro={
          <p className="meta date-availability-intro">
            Green days are explicitly available on that date. Other days follow your weekly pattern where it applies.
          </p>
        }
      />
    </div>
  );
}
