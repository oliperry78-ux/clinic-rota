import express from "express";
import cors from "cors";
import { pool, withTransaction } from "./database.js";
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
    const v = typeof json === "string" ? JSON.parse(json) : json;
    if (v && typeof v === "object" && v.all === true) return { all: true, clinics: [] };
    if (v && typeof v === "object" && v.all === false && Array.isArray(v.clinics)) {
      return { all: false, clinics: v.clinics.map(String) };
    }
  } catch {
    /* ignore */
  }
  return { all: true, clinics: [] };
}

/** JSON/JSONB from pg may arrive as object; API expects parsed nested objects like SQLite TEXT did. */
function coerceJsonText(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ---------- Staff ----------

app.get("/api/staff", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM staff ORDER BY LOWER(name) ASC");
    res.json(rows.map(normalizeStaffRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.post("/api/staff", async (req, res) => {
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
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff (name, role, email, phone, staff_type, availability_json, capacity, allowed_clinics_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name.trim(), roleNormalized, emailTrim, phoneTrim, staffType, availability_json, cap, allowed_clinics_json]
    );
    res.status(201).json(normalizeStaffRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.put("/api/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, role, email, phone, staff_type, availability, capacity, allowed_clinics } = req.body;
  try {
    const existingRes = await pool.query("SELECT * FROM staff WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: "staff not found" });

    const emailTrim = email !== undefined ? (String(email ?? "").trim() || null) : (existing.email ?? null);
    const phoneTrim = phone !== undefined ? (String(phone ?? "").trim() || null) : (existing.phone ?? null);
    const availability_json =
      availability !== undefined
        ? JSON.stringify(normalizeAvailabilityForStorage(availability))
        : coerceJsonText(existing.availability_json, '{"week1":[],"week2":[]}');
    const roleNormalized = role !== undefined ? normalizeRole(role) : normalizeRole(existing.role);
    const cap = capacity !== undefined ? normalizeCapacity(capacity) : normalizeCapacity(existing.capacity ?? 1);
    const staffType =
      staff_type !== undefined ? normalizeStaffType(staff_type) : normalizeStaffType(existing.staff_type);
    const allowed_clinics_json =
      allowed_clinics !== undefined
        ? JSON.stringify(normalizeAllowedClinicsInput(allowed_clinics))
        : coerceJsonText(existing.allowed_clinics_json, '{"all":true}');

    await pool.query(
      `UPDATE staff SET name = $1, role = $2, email = $3, phone = $4, staff_type = $5, availability_json = $6, capacity = $7, allowed_clinics_json = $8
       WHERE id = $9`,
      [
        name?.trim() ?? existing.name,
        roleNormalized,
        emailTrim,
        phoneTrim,
        staffType,
        availability_json,
        cap,
        allowed_clinics_json,
        id,
      ]
    );
    const { rows } = await pool.query("SELECT * FROM staff WHERE id = $1", [id]);
    res.json(normalizeStaffRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.delete("/api/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "invalid staff id" });
  }
  try {
    await pool.query("DELETE FROM staff_date_override WHERE staff_id = $1", [id]);
    await pool.query(
      "UPDATE shifts SET assigned_staff_id = NULL, assigned_staff_manual_override = FALSE WHERE assigned_staff_id = $1",
      [id]
    );
    await pool.query("DELETE FROM clinic_day_receptionist_slots WHERE staff_id = $1", [id]);
    const del = await pool.query("DELETE FROM staff WHERE id = $1", [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: "staff not found" });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

function normalizeStaffRow(row) {
  const { availability_json, allowed_clinics_json, ...rest } = row;
  const avStr = coerceJsonText(availability_json, '{"week1":[],"week2":[]}');
  const acStr = coerceJsonText(allowed_clinics_json, '{"all":true}');
  return {
    ...rest,
    role: normalizeRole(rest.role),
    availability: parseAvailabilityJson(avStr),
    allowed_clinics: parseAllowedClinicsJson(acStr),
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get("/api/date-overrides", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT staff_id, shift_date, override_type FROM staff_date_override");
    res.json({
      dateOverrides: rows.map((r) => ({
        staffId: String(r.staff_id),
        date: formatDateOverrideDate(r.shift_date),
        isAvailable: String(r.override_type) === "available",
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

/** Keep YYYY-MM-DD strings even if Postgres `date` columns return Date objects. */
function formatDateOverrideDate(v) {
  if (v == null) return v;
  if (typeof v === "string") return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return String(v);
}

/**
 * Replace date overrides for one staff member.
 *
 * Back-compat behavior:
 * - If payload contains only isAvailable:true overrides, we replace only 'available' rows (leave holidays).
 * - If payload contains only isAvailable:false overrides, we replace only 'unavailable' rows (leave available).
 * - If payload contains a mix, we replace both.
 */
app.put("/api/staff/:id/date-overrides", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "invalid staff id" });
  }
  const raw = req.body?.dateOverrides;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: "dateOverrides array required" });
  }

  try {
    const existingRes = await pool.query("SELECT id FROM staff WHERE id = $1", [id]);
    if (!existingRes.rows[0]) return res.status(404).json({ error: "staff not found" });

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

    await withTransaction(async (client) => {
      const scope =
        overrideScope ?? (sawTrue && sawFalse ? "both" : sawTrue ? "available" : sawFalse ? "unavailable" : "available");
      if (scope === "both") {
        await client.query("DELETE FROM staff_date_override WHERE staff_id = $1", [id]);
      } else if (scope === "available") {
        await client.query("DELETE FROM staff_date_override WHERE staff_id = $1 AND override_type = 'available'", [id]);
      } else if (scope === "unavailable") {
        await client.query("DELETE FROM staff_date_override WHERE staff_id = $1 AND override_type = 'unavailable'", [id]);
      }
      const insSql = `
        INSERT INTO staff_date_override (staff_id, shift_date, override_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (staff_id, shift_date, override_type) DO NOTHING
      `;
      for (const d of availableDates) {
        await client.query(insSql, [id, d, "available"]);
      }
      for (const d of unavailableDates) {
        await client.query(insSql, [id, d, "unavailable"]);
      }
    });

    const { rows } = await pool.query(
      "SELECT staff_id, shift_date, override_type FROM staff_date_override WHERE staff_id = $1",
      [id]
    );
    res.json({
      dateOverrides: rows.map((r) => ({
        staffId: String(r.staff_id),
        date: formatDateOverrideDate(r.shift_date),
        isAvailable: String(r.override_type) === "available",
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

// ---------- Shifts (sessions: schedule metadata; no session-level staffing in this engine) ----------

app.get("/api/shifts", async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate query params required" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shifts
       WHERE shift_date >= $1 AND shift_date <= $2
       ORDER BY shift_date, clinic, room, doctor, start_time, required_role`,
      [String(startDate), String(endDate)]
    );
    res.json(rows.map(augmentShiftRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.post("/api/shifts", async (req, res) => {
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
    const { rows } = await pool.query(
      `INSERT INTO shifts (shift_date, start_time, end_time, required_role, clinic, room, doctor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [shift_date, start_time, end_time, roleTrim, clinicTrim, roomTrim, doctorTrim]
    );
    res.status(201).json(augmentShiftRow(rows[0]));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "identical session already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.delete("/api/shifts/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const del = await pool.query("DELETE FROM shifts WHERE id = $1", [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: "shift not found" });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.get("/api/clinic-day-receptionist-slots", async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate query params required" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT shift_date, clinic, slot_index, staff_id, COALESCE(manual_override, FALSE) AS manual_override
       FROM clinic_day_receptionist_slots
       WHERE shift_date >= $1 AND shift_date <= $2
       ORDER BY shift_date, clinic, slot_index`,
      [String(startDate), String(endDate)]
    );
    const byBlock = new Map();
    for (const r of rows) {
      const sd = formatDateOverrideDate(r.shift_date);
      const key = `${sd}\0${r.clinic}`;
      if (!byBlock.has(key)) {
        byBlock.set(key, { shift_date: sd, clinic: r.clinic, slots: [] });
      }
      byBlock.get(key).slots.push({
        slot_index: r.slot_index,
        staff_id: r.staff_id,
        manual_override: Boolean(r.manual_override),
      });
    }
    res.json({ blocks: [...byBlock.values()] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.put("/api/clinic-day-receptionist-slots", async (req, res) => {
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
    const sid = Number(x);
    if (!Number.isFinite(sid) || sid <= 0) {
      return res.status(400).json({ error: "each staff id must be a positive number" });
    }
    staffIds.push(sid);
  }

  const manualRaw = req.body?.manualOverrides;
  const manualFlags = Array.isArray(manualRaw)
    ? manualRaw.map((v) => v === true || v === "true")
    : null;

  try {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM clinic_day_receptionist_slots WHERE shift_date = $1 AND clinic = $2", [
        shift_date,
        clinic,
      ]);
      const ins = `INSERT INTO clinic_day_receptionist_slots (shift_date, clinic, slot_index, staff_id, manual_override)
                   VALUES ($1, $2, $3, $4, $5)`;
      for (let idx = 0; idx < staffIds.length; idx++) {
        const mo = Boolean(manualFlags && manualFlags[idx] === true);
        await client.query(ins, [shift_date, clinic, idx, staffIds[idx], mo]);
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.patch("/api/shifts/:id/assign", async (req, res) => {
  const shiftId = Number(req.params.id);
  try {
    const existingRes = await pool.query("SELECT * FROM shifts WHERE id = $1", [shiftId]);
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: "shift not found" });

    const raw = req.body?.assigned_staff_id;
    let staffId = null;
    if (raw !== undefined && raw !== null && raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: "assigned_staff_id must be null or a positive staff id" });
      }
      const stRes = await pool.query("SELECT id FROM staff WHERE id = $1", [n]);
      if (!stRes.rows[0]) return res.status(400).json({ error: "staff not found" });
      staffId = n;
    }

    let manualOverride = Boolean(existing.assigned_staff_manual_override);
    if (staffId === null) {
      manualOverride = false;
    } else if (req.body?.assigned_staff_manual_override !== undefined && req.body?.assigned_staff_manual_override !== null) {
      manualOverride = Boolean(req.body.assigned_staff_manual_override);
    }

    await pool.query(
      "UPDATE shifts SET assigned_staff_id = $1, assigned_staff_manual_override = $2 WHERE id = $3",
      [staffId, manualOverride, shiftId]
    );
    const { rows } = await pool.query("SELECT * FROM shifts WHERE id = $1", [shiftId]);
    res.json(augmentShiftRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

app.patch("/api/shifts/:id", async (req, res) => {
  const shiftId = Number(req.params.id);
  try {
    const existingRes = await pool.query("SELECT * FROM shifts WHERE id = $1", [shiftId]);
    const existing = existingRes.rows[0];
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
      await pool.query(
        `UPDATE shifts SET shift_date = $1, start_time = $2, end_time = $3, required_role = $4, clinic = $5, room = $6, doctor = $7 WHERE id = $8`,
        [shift_date, start_time, end_time, required_role, clinicRaw, roomRaw, doctorRaw, shiftId]
      );
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "identical session already exists" });
      }
      throw err;
    }
    const { rows } = await pool.query("SELECT * FROM shifts WHERE id = $1", [shiftId]);
    res.json(augmentShiftRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

function augmentShiftRow(row) {
  if (!row) return row;
  const shift_date =
    row.shift_date instanceof Date && !Number.isNaN(row.shift_date.getTime())
      ? row.shift_date.toISOString().slice(0, 10)
      : row.shift_date;
  return {
    ...row,
    shift_date,
    date: shift_date,
  };
}

app.listen(PORT, () => {
  console.log(`Clinic rota API listening on http://localhost:${PORT}`);
});
