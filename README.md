# Clinic staff rota (v1)

A small full-stack app to manage staff, weekly shift templates, and assignments with basic validation.

## What it does

- **Staff**: name, role, weekly availability (days + time ranges).
- **Shifts**: date, start/end time, required role.
- **Rota**: assign people to shifts. The server rejects assignments when the role does not match, the person is not available, or they already have an overlapping shift that day.
- **Gaps**: unassigned shifts are labelled **Gap** and highlighted in the rota view.

## Tech

- **Backend**: Node.js + Express + SQLite (`better-sqlite3`).
- **Frontend**: React + Vite (proxies `/api` to the server in dev).

## Run locally

1. Install dependencies (from the project root):

   ```bash
   npm install
   npm run install:all
   ```

2. Start API + UI:

   ```bash
   npm run dev
   ```

3. Open **http://localhost:5173** (Vite). The API listens on **http://localhost:3001**.

The database file is created automatically at `server/rota.sqlite`.

## Project layout

- `server/database.js` – SQLite schema
- `server/scheduling.js` – availability / overlap checks (with comments)
- `server/index.js` – REST API
- `client/src/pages/` – Staff, Week shifts, Rota screens

## Notes (v1)

- One person per shift; overnight shifts are not supported.
- Role matching is case-insensitive.
- Week view uses **Monday–Sunday**.
