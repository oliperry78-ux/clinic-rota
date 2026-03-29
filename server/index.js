import express from "express";
import cors from "cors";
import { db } from "./database.js";
import { normalizeAvailabilityForStorage, parseAvailabilityJson } from "./scheduling.js";

function normalizeCapacity(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function normalizeStaffType(raw) {
  const s = String(raw ?? "").trim();
  if (s === "Full time" || s === "Part time" || s === "Temp") return s;
  return "Full time";
}

function normalizeRole(raw) {
  const role = String(raw ?? "").trim().toLowerCase();
  if (role === "assistant" || role === "doctors assistant") return "doctors assistant";
  if (role === "receptionist") return "receptionist";
  return "receptionist";
}

function normalizeAllowedClinicsInput(input) {
  if (input == null || typeof input !== "object") return { all: true, clinics: [] };
  if (input.all === true) return { all: true, clinics: [] };
  const clinics = Array.isArray(input.clinics)
    ? input.clinics.map((c) => String(c).trim()).filter(Boolean)
    : [];
  return { all: false, clinics };
}

function resolveShiftDateFromBody(body) {
  if (body.shift_date != null) return String(body.shift_date);
  if (body.date != null) return String(body.date);
  return "";
}

function pickShiftDateForUpdate(body, existing) {
  if (body.shift_date !== undefined) return String(body.shift_date);
  if (body.date !== undefined) return String(body.date);
  return existing.shift_date;
}

function parseAllowedClinicsJson(json) {
  try {
    const v = JSON.parse(json);
    if (v && typeof v === "object" && v.all === true) return { all: true, clinics: [] };
    if (v && typeof v === "object" && v.all === false && Array.isArray(v.clinics)) {
      return { all: false, clinics: v.clinics.map(String) };
    }
  } catch {
    /* ignore */
  }
  return { all: true, clinics: [] };
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ---------- Staff ----------

app.get("/api/staff", (_req, res) => {
  const rows = db.prepare("SELECT * FROM staff ORDER BY name COLLATE NOCASE").all();
  res.json(rows.map(normalizeStaffRow));
});

app.post("/api/staff", (req, res) => {
  const { name, role, staff_type, availability, capacity, allowed_clinics } = req.body;
  if (!name || !role) {
    return res.status(400).json({ error: "name and role are required" });
  }
  const availability_json = JSON.stringify(normalizeAvailabilityForStorage(availability));
  const roleNormalized = normalizeRole(role);
  const cap = normalizeCapacity(capacity ?? 1);
  const staffType = normalizeStaffType(staff_type);
  const allowed_clinics_json = JSON.stringify(normalizeAllowedClinicsInput(allowed_clinics));
  const info = db
    .prepare(
      "INSERT INTO staff (name, role, staff_type, availability_json, capacity, allowed_clinics_json) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(name.trim(), roleNormalized, staffType, availability_json, cap, allowed_clinics_json);
  const row = db.prepare("SELECT * FROM staff WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(normalizeStaffRow(row));
});

app.put("/api/staff/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, role, staff_type, availability, capacity, allowed_clinics } = req.body;
  const existing = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "staff not found" });

  const availability_json =
    availability !== undefined
      ? JSON.stringify(normalizeAvailabilityForStorage(availability))
      : existing.availability_json;
  const roleNormalized = role !== undefined ? normalizeRole(role) : normalizeRole(existing.role);
  const cap = capacity !== undefined ? normalizeCapacity(capacity) : normalizeCapacity(existing.capacity ?? 1);
  const staffType =
    staff_type !== undefined ? normalizeStaffType(staff_type) : normalizeStaffType(existing.staff_type);
  const allowed_clinics_json =
    allowed_clinics !== undefined
      ? JSON.stringify(normalizeAllowedClinicsInput(allowed_clinics))
      : (existing.allowed_clinics_json ?? '{"all":true}');

  db.prepare(
    "UPDATE staff SET name = ?, role = ?, staff_type = ?, availability_json = ?, capacity = ?, allowed_clinics_json = ? WHERE id = ?"
  ).run(
    name?.trim() ?? existing.name,
    roleNormalized,
    staffType,
    availability_json,
    cap,
    allowed_clinics_json,
    id
  );
  const row = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
  res.json(normalizeStaffRow(row));
});

app.delete("/api/staff/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE shifts SET assigned_staff_id = NULL WHERE assigned_staff_id = ?").run(id);
  const info = db.prepare("DELETE FROM staff WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "staff not found" });
  res.status(204).send();
});

function normalizeStaffRow(row) {
  const { availability_json, allowed_clinics_json, ...rest } = row;
  return {
    ...rest,
    role: normalizeRole(rest.role),
    availability: parseAvailabilityJson(availability_json),
    allowed_clinics: parseAllowedClinicsJson(allowed_clinics_json),
  };
}

// ---------- Shifts (sessions: schedule metadata; no session-level staffing in this engine) ----------

app.get("/api/shifts", (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate query params required" });
  }

  const rows = db
    .prepare(
      `SELECT * FROM shifts
       WHERE shift_date >= ? AND shift_date <= ?
       ORDER BY shift_date, clinic, room, doctor, start_time, required_role`
    )
    .all(String(startDate), String(endDate));

  res.json(rows.map(augmentShiftRow));
});

app.post("/api/shifts", (req, res) => {
  const shift_date = resolveShiftDateFromBody(req.body);
  const { start_time, end_time, required_role } = req.body;
  if (!shift_date || !start_time || !end_time) {
    return res.status(400).json({ error: "date (or shift_date), start_time, and end_time are required" });
  }
  const clinicTrim = String(req.body.clinic ?? "").trim();
  const roomTrim = String(req.body.room ?? "").trim();
  const doctorTrim = String(req.body.doctor ?? "").trim();
  if (!clinicTrim) {
    return res.status(400).json({ error: "clinic is required" });
  }
  if (!roomTrim) {
    return res.status(400).json({ error: "room is required" });
  }
  if (!doctorTrim) {
    return res.status(400).json({ error: "doctor is required" });
  }
  const roleTrim = String(required_role ?? "session").trim() || "session";
  try {
    const info = db
      .prepare(
        `INSERT INTO shifts (shift_date, start_time, end_time, required_role, clinic, room, doctor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(shift_date, start_time, end_time, roleTrim, clinicTrim, roomTrim, doctorTrim);
    const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(augmentShiftRow(row));
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "identical session already exists" });
    }
    throw e;
  }
});

app.delete("/api/shifts/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM shifts WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "shift not found" });
  res.status(204).send();
});

app.patch("/api/shifts/:id/assign", (req, res) => {
  const shiftId = Number(req.params.id);
  const row = db.prepare("SELECT id FROM shifts WHERE id = ?").get(shiftId);
  if (!row) return res.status(404).json({ error: "shift not found" });
  return res.status(400).json({
    error:
      "Session-level staff assignment is not used. Doctor appears as metadata only; receptionist coverage is combination-based on the Rota page.",
  });
});

app.patch("/api/shifts/:id", (req, res) => {
  const shiftId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM shifts WHERE id = ?").get(shiftId);
  if (!existing) return res.status(404).json({ error: "shift not found" });

  const shift_date = pickShiftDateForUpdate(req.body, existing);
  const start_time = req.body.start_time !== undefined ? req.body.start_time : existing.start_time;
  const end_time = req.body.end_time !== undefined ? req.body.end_time : existing.end_time;
  const required_role =
    req.body.required_role !== undefined ? String(req.body.required_role).trim() : existing.required_role;
  const clinicRaw = req.body.clinic !== undefined ? String(req.body.clinic).trim() : String(existing.clinic ?? "").trim();
  const roomRaw = req.body.room !== undefined ? String(req.body.room).trim() : String(existing.room ?? "").trim();
  const doctorRaw = req.body.doctor !== undefined ? String(req.body.doctor).trim() : String(existing.doctor ?? "").trim();
  if (!clinicRaw) {
    return res.status(400).json({ error: "clinic is required" });
  }
  if (!roomRaw) {
    return res.status(400).json({ error: "room is required" });
  }
  if (!doctorRaw) {
    return res.status(400).json({ error: "doctor is required" });
  }

  try {
    db.prepare(
      `UPDATE shifts SET shift_date = ?, start_time = ?, end_time = ?, required_role = ?, clinic = ?, room = ?, doctor = ? WHERE id = ?`
    ).run(shift_date, start_time, end_time, required_role, clinicRaw, roomRaw, doctorRaw, shiftId);
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "identical session already exists" });
    }
    throw e;
  }
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(shiftId);
  res.json(augmentShiftRow(row));
});

function augmentShiftRow(row) {
  if (!row) return row;
  return {
    ...row,
    date: row.shift_date,
  };
}

app.listen(PORT, () => {
  console.log(`Clinic rota API listening on http://localhost:${PORT}`);
});
