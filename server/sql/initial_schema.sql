create table if not exists staff (
  id bigserial primary key,
  name text not null,
  role text not null,
  email text,
  phone text,
  staff_type text not null default 'Full time',
  availability_json text not null default '{"week1":[],"week2":[]}',
  capacity integer not null default 1,
  allowed_clinics_json text not null default '{"all":true}'
);

create table if not exists shifts (
  id bigserial primary key,
  shift_date text not null,
  start_time text not null,
  end_time text not null,
  required_role text not null,
  clinic text not null default '',
  room text not null default '',
  doctor text not null default '',
  assigned_staff_id bigint references staff(id) on delete set null,
  unique (shift_date, start_time, end_time, required_role, clinic, room, doctor)
);

create index if not exists idx_shifts_date on shifts(shift_date);
create index if not exists idx_shifts_assigned on shifts(assigned_staff_id);

create table if not exists clinic_day_receptionist_slots (
  id bigserial primary key,
  shift_date text not null,
  clinic text not null,
  slot_index integer not null,
  staff_id bigint references staff(id) on delete set null,
  unique (shift_date, clinic, slot_index)
);

create index if not exists idx_cdr_date_clinic on clinic_day_receptionist_slots(shift_date, clinic);
create index if not exists idx_cdr_staff on clinic_day_receptionist_slots(staff_id);

create table if not exists staff_date_override (
  staff_id bigint not null references staff(id) on delete cascade,
  shift_date text not null,
  override_type text not null check (override_type in ('available', 'unavailable')),
  primary key (staff_id, shift_date, override_type)
);

create index if not exists idx_staff_date_override_date on staff_date_override(shift_date);