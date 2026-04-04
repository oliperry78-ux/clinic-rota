-- Required for Week 1 anchor: GET/PUT /api/settings read/write this table.
-- Run once per Postgres database (e.g. Supabase → SQL editor → paste → Run).
-- Without this migration, those routes return a database error (JSON), not the anchor.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_settings (key, value)
VALUES ('biweek_week1_anchor_date', '2000-01-03')
ON CONFLICT (key) DO NOTHING;
