-- Adds 'doctor' as a permitted value for the staff.role column.
-- Run once in Supabase SQL editor before deploying the code changes.
-- If no CHECK constraint exists on staff.role, this script is safe to run anyway (the DROP is conditional).

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_allowed_values;

ALTER TABLE public.staff
  ADD CONSTRAINT staff_role_allowed_values
  CHECK (role IN ('receptionist', 'doctors assistant', 'doctor'));
