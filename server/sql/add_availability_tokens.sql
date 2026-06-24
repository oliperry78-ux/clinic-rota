-- Availability tokens for public staff self-serve availability links.
-- Run once per Postgres database (Supabase SQL editor or psql).
-- The availability_tokens table must already exist before the backend routes are deployed.

CREATE TABLE IF NOT EXISTS availability_tokens (
  id           BIGSERIAL PRIMARY KEY,
  staff_id     BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_availability_tokens_token
  ON availability_tokens(token);

CREATE INDEX IF NOT EXISTS idx_availability_tokens_staff_id
  ON availability_tokens(staff_id);
