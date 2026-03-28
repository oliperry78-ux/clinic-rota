import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Human labels matching JS getDay(): 0 = Sunday … 6 = Saturday */
const DAY_ROWS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

function emptyAvailability() {
  return DAY_ROWS.map(({ day }) => ({
    day,
    enabled: false,
    start: "09:00",
    end: "17:00",
  }));
}

function staffToRows(availability) {
  const byDay = Object.fromEntries((availability || []).map((a) => [a.day, a]));
  return DAY_ROWS.map(({ day, label }) => {
    const slot = byDay[day];
    return {
      day,
      label,
      enabled: !!slot,
      start: slot?.start ?? "09:00",
      end: slot?.end ?? "17:00",
    };
  });
}

function rowsToAvailability(rows) {
  return rows
    .filter((r) => r.enabled)
    .map((r) => ({ day: r.day, start: r.start, end: r.end }));
}

function parseClinicsCsv(text) {
  return String(text || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatAllowedClinics(ac) {
  if (!ac || ac.all) return "All clinics";
  if (!ac.clinics?.length) return "Selected clinics (add names)";
  return ac.clinics.join(", ");
}

function clampCapacity(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return v;
}

function allowedClinicsPayload(all, text) {
  if (all) return { all: true };
  return { all: false, clinics: parseClinicsCsv(text) };
}

function AvailabilityEditor({ rows, onChange }) {
  return (
    <div className="avail-grid">
      {rows.map((row, idx) => (
        <div key={row.day} className="avail-row">
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...next[idx], enabled: e.target.checked };
                onChange(next);
              }}
            />
            {DAY_ROWS.find((d) => d.day === row.day)?.label}
          </label>
          <div>
            <label>From</label>
            <input
              type="time"
              value={row.start}
              disabled={!row.enabled}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...next[idx], start: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <div>
            <label>To</label>
            <input
              type="time"
              value={row.end}
              disabled={!row.enabled}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...next[idx], end: e.target.value };
                onChange(next);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("receptionist");
  const [staffType, setStaffType] = useState("Full time");
  const [capacity, setCapacity] = useState(1);
  const [createAllowedAll, setCreateAllowedAll] = useState(true);
  const [createAllowedClinicsText, setCreateAllowedClinicsText] = useState("");
  /** Rows for the “Add staff” form only */
  const [createRows, setCreateRows] = useState(() => emptyAvailability());
  const [editingId, setEditingId] = useState(null);
  const [editRows, setEditRows] = useState(() => emptyAvailability());
  const [editRole, setEditRole] = useState("receptionist");
  const [editStaffType, setEditStaffType] = useState("Full time");
  const [editCapacity, setEditCapacity] = useState(1);
  const [editAllowedAll, setEditAllowedAll] = useState(true);
  const [editAllowedClinicsText, setEditAllowedClinicsText] = useState("");

  async function load() {
    setError(null);
    try {
      const list = await api.getStaff();
      setStaff(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createStaff({
        name,
        role,
        staff_type: staffType,
        availability: rowsToAvailability(createRows),
        capacity: clampCapacity(capacity),
        allowed_clinics: allowedClinicsPayload(createAllowedAll, createAllowedClinicsText),
      });
      setName("");
      setRole("receptionist");
      setStaffType("Full time");
      setCapacity(1);
      setCreateAllowedAll(true);
      setCreateAllowedClinicsText("");
      setCreateRows(emptyAvailability());
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditRows(staffToRows(s.availability));
    setEditRole(s.role ?? "receptionist");
    setEditStaffType(s.staff_type ?? "Full time");
    setEditCapacity(clampCapacity(s.capacity ?? 1));
    const ac = s.allowed_clinics;
    setEditAllowedAll(!ac || ac.all !== false);
    setEditAllowedClinicsText(ac?.all === false && Array.isArray(ac.clinics) ? ac.clinics.join(", ") : "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    setError(null);
    try {
      const s = staff.find((x) => x.id === editingId);
      await api.updateStaff(editingId, {
        name: s.name,
        role: editRole,
        staff_type: editStaffType,
        availability: rowsToAvailability(editRows),
        capacity: clampCapacity(editCapacity),
        allowed_clinics: allowedClinicsPayload(editAllowedAll, editAllowedClinicsText),
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm("Remove this staff member? Assignments on shifts will be cleared.")) return;
    setError(null);
    try {
      await api.deleteStaff(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function formatAvail(av) {
    if (!av?.length) return "—";
    const names = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
    return av.map((a) => `${names[a.day]} ${a.start}–${a.end}`).join(", ");
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      <section className="card">
        <h2>Add staff</h2>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          Set which days and hours each person can work. The rota only allows assignments inside these
          windows.
        </p>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <div>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Alex" />
            </div>
            <div>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} required>
                <option value="receptionist">receptionist</option>
                <option value="doctors assistant">doctors assistant</option>
              </select>
            </div>
            <div>
              <label>Staff type</label>
              <select value={staffType} onChange={(e) => setStaffType(e.target.value)} required>
                <option value="Full time">Full time</option>
                <option value="Part time">Part time</option>
                <option value="Temp">Temp</option>
              </select>
            </div>
            <div>
              <label>Capacity</label>
              <input
                type="number"
                min={1}
                step={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={() => setCapacity((c) => clampCapacity(c === "" ? 1 : c))}
                required
                title="Minimum 1 (e.g. concurrent patients a receptionist can handle)"
              />
            </div>
            <button type="submit">Add</button>
          </div>
          <div className="form-row" style={{ marginTop: "0.5rem", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 12rem" }}>
              <label>Allowed clinics</label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={createAllowedAll}
                  onChange={(e) => setCreateAllowedAll(e.target.checked)}
                />
                All clinics
              </label>
              {!createAllowedAll && (
                <textarea
                  style={{ width: "100%", marginTop: "0.35rem", minHeight: "4rem" }}
                  value={createAllowedClinicsText}
                  onChange={(e) => setCreateAllowedClinicsText(e.target.value)}
                  placeholder="Comma-separated clinic names or IDs (e.g. Main, North)"
                />
              )}
            </div>
          </div>
          <AvailabilityEditor rows={createRows} onChange={setCreateRows} />
        </form>
      </section>

      <section className="card">
        <h2>All staff</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <table className="staff-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Staff type</th>
                <th>Capacity</th>
                <th>Allowed clinics</th>
                <th>Availability</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.role}</td>
                  <td>{s.staff_type ?? "Full time"}</td>
                  <td>{clampCapacity(s.capacity ?? 1)}</td>
                  <td style={{ maxWidth: "14rem", fontSize: "0.85rem" }}>{formatAllowedClinics(s.allowed_clinics)}</td>
                  <td>{formatAvail(s.availability)}</td>
                  <td>
                    {editingId === s.id ? (
                      <>
                        <button type="button" className="secondary" onClick={cancelEdit}>
                          Cancel
                        </button>{" "}
                        <button type="button" onClick={saveEdit}>
                          Save
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="secondary" onClick={() => startEdit(s)}>
                          Edit
                        </button>{" "}
                        <button type="button" className="danger" onClick={() => remove(s.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editingId != null && (
        <section className="card">
          <h2>Editing — {staff.find((s) => s.id === editingId)?.name}</h2>
          <div className="form-row" style={{ marginBottom: "0.75rem" }}>
            <div>
              <label>Capacity</label>
              <input
                type="number"
                min={1}
                step={1}
                value={editCapacity}
                onChange={(e) => setEditCapacity(e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={() => setEditCapacity((c) => clampCapacity(c === "" ? 1 : c))}
              />
            </div>
            <div>
              <label>Role</label>
              <select value={editRole} onChange={(e) => setEditRole(e.target.value)} required>
                <option value="receptionist">receptionist</option>
                <option value="doctors assistant">doctors assistant</option>
              </select>
            </div>
            <div>
              <label>Staff type</label>
              <select value={editStaffType} onChange={(e) => setEditStaffType(e.target.value)} required>
                <option value="Full time">Full time</option>
                <option value="Part time">Part time</option>
                <option value="Temp">Temp</option>
              </select>
            </div>
            <div style={{ flex: "1 1 14rem" }}>
              <label>Allowed clinics</label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={editAllowedAll}
                  onChange={(e) => setEditAllowedAll(e.target.checked)}
                />
                All clinics
              </label>
              {!editAllowedAll && (
                <textarea
                  style={{ width: "100%", marginTop: "0.35rem", minHeight: "4rem" }}
                  value={editAllowedClinicsText}
                  onChange={(e) => setEditAllowedClinicsText(e.target.value)}
                  placeholder="Comma-separated clinic names or IDs"
                />
              )}
            </div>
          </div>
          <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Availability</h3>
          <AvailabilityEditor rows={editRows} onChange={setEditRows} />
        </section>
      )}
    </div>
  );
}
