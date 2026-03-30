import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "rota.sqlite");

/** Single SQLite connection for the app (fine for v1 / single user). */
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Schema: staff + shifts (assignment stored on shift row for simplicity) ---

db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    staff_type TEXT NOT NULL DEFAULT 'Full time',
    /* JSON: { "week1": [...], "week2": [...] } — weekday slots per repeating biweek half */
    availability_json TEXT NOT NULL DEFAULT '{"week1":[],"week2":[]}',
    capacity INTEGER NOT NULL DEFAULT 1,
    /* JSON: { "all": true } or { "all": false, "clinics": ["Main", …] } */
    allowed_clinics_json TEXT NOT NULL DEFAULT '{"all":true}'
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_date TEXT NOT NULL,       -- YYYY-MM-DD (API also exposes as date)
    start_time TEXT NOT NULL,       -- HH:mm
    end_time TEXT NOT NULL,
    required_role TEXT NOT NULL,
    clinic TEXT NOT NULL DEFAULT '',
    room TEXT NOT NULL DEFAULT '',
    doctor TEXT NOT NULL DEFAULT '',
    assigned_staff_id INTEGER REFERENCES staff(id),
    UNIQUE (shift_date, start_time, end_time, required_role, clinic, room, doctor)
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);
  CREATE INDEX IF NOT EXISTS idx_shifts_assigned ON shifts(assigned_staff_id);

  CREATE TABLE IF NOT EXISTS clinic_day_receptionist_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_date TEXT NOT NULL,
    clinic TEXT NOT NULL,
    slot_index INTEGER NOT NULL,
    staff_id INTEGER REFERENCES staff(id),
    UNIQUE (shift_date, clinic, slot_index)
  );
  CREATE INDEX IF NOT EXISTS idx_cdr_date_clinic ON clinic_day_receptionist_slots(shift_date, clinic);
  CREATE INDEX IF NOT EXISTS idx_cdr_staff ON clinic_day_receptionist_slots(staff_id);

  CREATE TABLE IF NOT EXISTS staff_date_override (
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    shift_date TEXT NOT NULL,
    is_available INTEGER NOT NULL,
    PRIMARY KEY (staff_id, shift_date)
  );
  CREATE INDEX IF NOT EXISTS idx_staff_date_override_date ON staff_date_override(shift_date);
`);

function migrateStaffColumns() {
  const cols = db.prepare("PRAGMA table_info(staff)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("capacity")) {
    db.exec("ALTER TABLE staff ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1");
  }
  if (!names.has("allowed_clinics_json")) {
    db.exec(`ALTER TABLE staff ADD COLUMN allowed_clinics_json TEXT NOT NULL DEFAULT '{"all":true}'`);
  }
  if (!names.has("staff_type")) {
    db.exec(`ALTER TABLE staff ADD COLUMN staff_type TEXT NOT NULL DEFAULT 'Full time'`);
  }
}

/**
 * Older DBs used UNIQUE(shift_date, start_time, end_time, required_role) only.
 * Rebuild so the same slot can exist at different clinics, and clinic is a first-class column.
 */
function migrateShiftsClinicUnique() {
  const ti = db.prepare("PRAGMA table_info(shifts)").all();
  if (ti.length === 0) return;
  const names = new Set(ti.map((c) => c.name));
  if (!names.has("clinic")) {
    db.exec(`ALTER TABLE shifts ADD COLUMN clinic TEXT NOT NULL DEFAULT '';`);
  }

  const idxRows = db.prepare("PRAGMA index_list('shifts')").all();
  const uniqueIdx = idxRows.find((r) => r.unique === 1);
  if (!uniqueIdx) return;
  const colCount = db.prepare(`PRAGMA index_info("${uniqueIdx.name}")`).all().length;
  if (colCount >= 5) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE shifts__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        required_role TEXT NOT NULL,
        clinic TEXT NOT NULL,
        assigned_staff_id INTEGER REFERENCES staff(id),
        UNIQUE (shift_date, start_time, end_time, required_role, clinic)
      );
    `);
    db.exec(`
      INSERT INTO shifts__new (id, shift_date, start_time, end_time, required_role, clinic, assigned_staff_id)
      SELECT id, shift_date, start_time, end_time, required_role,
             COALESCE(NULLIF(TRIM(clinic), ''), ''),
             assigned_staff_id
      FROM shifts;
    `);
    db.exec("DROP TABLE shifts");
    db.exec("ALTER TABLE shifts__new RENAME TO shifts");
    db.exec("CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_shifts_assigned ON shifts(assigned_staff_id)");
  });
  tx();
}

/**
 * Sessions are distinct by clinic + room + doctor (and time/role).
 * Adds room/doctor columns and rebuilds when the unique index is not the 7-column key.
 */
function migrateShiftsSessionUnique() {
  const ti = db.prepare("PRAGMA table_info(shifts)").all();
  if (ti.length === 0) return;
  const names = new Set(ti.map((c) => c.name));
  if (!names.has("room")) {
    db.exec(`ALTER TABLE shifts ADD COLUMN room TEXT NOT NULL DEFAULT '';`);
  }
  if (!names.has("doctor")) {
    db.exec(`ALTER TABLE shifts ADD COLUMN doctor TEXT NOT NULL DEFAULT '';`);
  }

  const idxRows = db.prepare("PRAGMA index_list('shifts')").all();
  const uniqueIdx = idxRows.find((r) => r.unique === 1);
  if (!uniqueIdx) return;
  const colCount = db.prepare(`PRAGMA index_info("${uniqueIdx.name}")`).all().length;
  if (colCount === 7) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE shifts__session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        required_role TEXT NOT NULL,
        clinic TEXT NOT NULL,
        room TEXT NOT NULL,
        doctor TEXT NOT NULL,
        assigned_staff_id INTEGER REFERENCES staff(id),
        UNIQUE (shift_date, start_time, end_time, required_role, clinic, room, doctor)
      );
    `);
    db.exec(`
      INSERT INTO shifts__session (id, shift_date, start_time, end_time, required_role, clinic, room, doctor, assigned_staff_id)
      SELECT id, shift_date, start_time, end_time, required_role,
             COALESCE(NULLIF(TRIM(clinic), ''), ''),
             COALESCE(NULLIF(TRIM(room), ''), ''),
             COALESCE(NULLIF(TRIM(doctor), ''), ''),
             assigned_staff_id
      FROM shifts;
    `);
    db.exec("DROP TABLE shifts");
    db.exec("ALTER TABLE shifts__session RENAME TO shifts");
    db.exec("CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_shifts_assigned ON shifts(assigned_staff_id)");
  });
  tx();
}

/** Sessions are not staff-assigned in the rota engine; tag row for uniqueness only. */
function migrateShiftSessionRoleTag() {
  try {
    db.prepare(
      `UPDATE shifts SET required_role = 'session'
       WHERE lower(trim(required_role)) IN ('receptionist', 'dentist')`
    ).run();
  } catch {
    /* shifts may not exist yet */
  }
}

/** Rename legacy staff role label to the new canonical value. */
function migrateStaffAssistantRoleName() {
  try {
    db.prepare(
      `UPDATE staff
       SET role = 'doctors assistant'
       WHERE lower(trim(role)) = 'assistant'`
    ).run();
  } catch {
    /* staff may not exist yet */
  }
}

migrateStaffColumns();
migrateShiftsClinicUnique();
migrateShiftsSessionUnique();
migrateShiftSessionRoleTag();
migrateStaffAssistantRoleName();

/** Legacy rows stored a single weekly array; copy it to both week1 and week2. */
function migrateStaffBiweeklyAvailability() {
  const rows = db.prepare("SELECT id, availability_json FROM staff").all();
  for (const row of rows) {
    let raw;
    try {
      raw = JSON.parse(row.availability_json);
    } catch {
      continue;
    }
    if (Array.isArray(raw)) {
      db.prepare("UPDATE staff SET availability_json = ? WHERE id = ?").run(
        JSON.stringify({ week1: raw, week2: raw }),
        row.id
      );
    }
  }
}

migrateStaffBiweeklyAvailability();
