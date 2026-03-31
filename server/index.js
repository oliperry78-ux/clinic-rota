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
  const { name, role, email, phone, staff_type, availability, capacity, allowed_clinics } = req.body;
  if (!name || !role) {
    return res.status(400).json({ error: "name and role are required" });
  }
  const availability_json = JSON.stringify(normalizeAvailabilityForStorage(availability));
  const roleNormalized = normalizeRole(role);
  const cap = normalizeCapacity(capacity ?? 1);
  const staffType = normalizeStaffType(staff_type);
  const allowed_clinics_json = JSON.stringify(normalizeAllowedClinicsInput(allowed_clinics));
  const emailTrim = String(email ?? "").trim() || null;
  const phoneTrim = String(phone ?? "").trim() || null;
  const info = db
    .prepare(
      "INSERT INTO staff (name, role, email, phone, staff_type, availability_json, capacity, allowed_clinics_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(name.trim(), roleNormalized, emailTrim, phoneTrim, staffType, availability_json, cap, allowed_clinics_json);
  const row = db.prepare("SELECT * FROM staff WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(normalizeStaffRow(row));
});

app.put("/api/staff/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, role, email, phone, staff_type, availability, capacity, allowed_clinics } = req.body;
  const existing = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "staff not found" });

  const emailTrim = email !== undefined ? (String(email ?? "").trim() || null) : (existing.email ?? null);
  const phoneTrim = phone !== undefined ? (String(phone ?? "").trim() || null) : (existing.phone ?? null);
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
    "UPDATE staff SET name = ?, role = ?, email = ?, phone = ?, staff_type = ?, availability_json = ?, capacity = ?, allowed_clinics_json = ? WHERE id = ?"
  ).run(
    name?.trim() ?? existing.name,
    roleNormalized,
    emailTrim,
    phoneTrim,
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
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "invalid staff id" });
  }
  db.prepare("DELETE FROM staff_date_override WHERE staff_id = ?").run(id);
  db.prepare("UPDATE shifts SET assigned_staff_id = NULL WHERE assigned_staff_id = ?").run(id);
  db.prepare("DELETE FROM clinic_day_receptionist_slots WHERE staff_id = ?").run(id);
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get("/api/date-overrides", (_req, res) => {
  const rows = db.prepare("SELECT staff_id, shift_date, override_type FROM staff_date_override").all();
  res.json({
    dateOverrides: rows.map((r) => ({
      staffId: String(r.staff_id),
      date: r.shift_date,
      isAvailable: String(r.override_type) === "available",
    })),
  });
});

/**
 * Replace date overrides for one staff member.
 *
 * Back-compat behavior:
 * - If payload contains only isAvailable:true overrides, we replace only 'available' rows (leave holidays).
 * - If payload contains only isAvailable:false overrides, we replace only 'unavailable' rows (leave available).
 * - If payload contains a mix, we replace both.
 */
app.put("/api/staff/:id/date-overrides", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "invalid staff id" });
  }
  const existing = db.prepare("SELECT id FROM staff WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "staff not found" });

  const raw = req.body?.dateOverrides;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: "dateOverrides array required" });
  }

  const overrideScopeRaw = String(req.body?.overrideScope ?? "").trim().toLowerCase();
  const overrideScope =
    overrideScopeRaw === "available" || overrideScopeRaw === "unavailable" || overrideScopeRaw === "both"
      ? overrideScopeRaw
      : null;

  const availableDates = new Set();
  const unavailableDates = new Set();
  let sawTrue = false;
  let sawFalse = false;
  for (const o of raw) {
    const date = String(o?.date ?? "").trim();
    if (!ISO_DATE_RE.test(date)) continue;
    const isAvail = o?.isAvailable === false ? false : true;
    if (isAvail) {
      sawTrue = true;
      availableDates.add(date);
    } else {
      sawFalse = true;
      unavailableDates.add(date);
    }
  }

  const tx = db.transaction(() => {
    const scope = overrideScope ?? (sawTrue && sawFalse ? "both" : sawTrue ? "available" : sawFalse ? "unavailable" : "available");
    if (scope === "both") {
      db.prepare("DELETE FROM staff_date_override WHERE staff_id = ?").run(id);
    } else if (scope === "available") {
      db.prepare("DELETE FROM staff_date_override WHERE staff_id = ? AND override_type = 'available'").run(id);
    } else if (scope === "unavailable") {
      db.prepare("DELETE FROM staff_date_override WHERE staff_id = ? AND override_type = 'unavailable'").run(id);
    }
    const ins = db.prepare(
      "INSERT OR REPLACE INTO staff_date_override (staff_id, shift_date, override_type) VALUES (?, ?, ?)"
    );
    for (const d of availableDates) {
      ins.run(id, d, "available");
    }
    for (const d of unavailableDates) {
      ins.run(id, d, "unavailable");
    }
  });
  tx();

  const rows = db
    .prepare("SELECT staff_id, shift_date, override_type FROM staff_date_override WHERE staff_id = ?")
    .all(id);
  res.json({
    dateOverrides: rows.map((r) => ({
      staffId: String(r.staff_id),
      date: r.shift_date,
      isAvailable: String(r.override_type) === "available",
    })),
  });
});

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

app.get("/api/clinic-day-receptionist-slots", (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate query params required" });
  }
  const rows = db
    .prepare(
      `SELECT shift_date, clinic, slot_index, staff_id
       FROM clinic_day_receptionist_slots
       WHERE shift_date >= ? AND shift_date <= ?
       ORDER BY shift_date, clinic, slot_index`
    )
    .all(String(startDate), String(endDate));

  const byBlock = new Map();
  for (const r of rows) {
    const key = `${r.shift_date}\0${r.clinic}`;
    if (!byBlock.has(key)) {
      byBlock.set(key, { shift_date: r.shift_date, clinic: r.clinic, slots: [] });
    }
    byBlock.get(key).slots.push({ slot_index: r.slot_index, staff_id: r.staff_id });
  }
  res.json({ blocks: [...byBlock.values()] });
});

app.put("/api/clinic-day-receptionist-slots", (req, res) => {
  const shift_date = String(req.body?.shift_date ?? "").trim();
  const clinic = String(req.body?.clinic ?? "").trim();
  const staffIdsRaw = req.body?.staffIds;
  if (!ISO_DATE_RE.test(shift_date)) {
    return res.status(400).json({ error: "shift_date (YYYY-MM-DD) required" });
  }
  if (!Array.isArray(staffIdsRaw)) {
    return res.status(400).json({ error: "staffIds array required" });
  }

  const staffIds = [];
  for (const x of staffIdsRaw) {
    if (x == null || x === "") continue;
    const id = Number(x);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "each staff id must be a positive number" });
    }
    staffIds.push(id);
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM clinic_day_receptionist_slots WHERE shift_date = ? AND clinic = ?").run(shift_date, clinic);
    const ins = db.prepare(
      `INSERT INTO clinic_day_receptionist_slots (shift_date, clinic, slot_index, staff_id)
       VALUES (?, ?, ?, ?)`
    );
    staffIds.forEach((staffId, idx) => {
      ins.run(shift_date, clinic, idx, staffId);
    });
  });
  tx();
  res.json({ ok: true });
});

app.patch("/api/shifts/:id/assign", (req, res) => {
  const shiftId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM shifts WHERE id = ?").get(shiftId);
  if (!existing) return res.status(404).json({ error: "shift not found" });

  const raw = req.body?.assigned_staff_id;
  let staffId = null;
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "assigned_staff_id must be null or a positive staff id" });
    }
    const st = db.prepare("SELECT id FROM staff WHERE id = ?").get(n);
    if (!st) return res.status(400).json({ error: "staff not found" });
    staffId = n;
  }

  db.prepare("UPDATE shifts SET assigned_staff_id = ? WHERE id = ?").run(staffId, shiftId);
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(shiftId);
  res.json(augmentShiftRow(row));
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
