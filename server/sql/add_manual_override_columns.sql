-- Run once on Postgres (e.g. Supabase SQL editor) before using manual assignment overrides.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS assigned_staff_manual_override BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE clinic_day_receptionist_slots ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE;
