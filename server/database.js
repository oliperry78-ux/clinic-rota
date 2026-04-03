import "dotenv/config";
import pg from "pg";

const rawUrl = process.env.DATABASE_URL;
const connectionString = rawUrl && String(rawUrl).trim() ? String(rawUrl).trim() : "";
const databaseUrlSet = Boolean(connectionString);

console.log(`DATABASE_URL set: ${databaseUrlSet}`);

if (!databaseUrlSet) {
  console.error("DATABASE_URL environment variable is required (Postgres connection string).");
  process.exit(1);
}

const poolConfig = {
  connectionString,
  max: 10,
};
if (/supabase\.(co|com)|pooler\.supabase/i.test(connectionString)) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

/** Shared pool for the Express API. Schema is managed in Supabase / migrations, not here. */
export const pool = new pg.Pool(poolConfig);

try {
  await pool.query("SELECT NOW()");
  console.log("Postgres connection: OK (SELECT NOW() succeeded)");
} catch (err) {
  console.error("Postgres connection: FAILED (SELECT NOW() error)");
  console.error("message:", err?.message);
  console.error("code:", err?.code);
  console.error("detail:", err?.detail);
  console.error("hint:", err?.hint);
  console.error("name:", err?.name);
  process.exit(1);
}

/**
 * Run `callback` inside a transaction (BEGIN … COMMIT / ROLLBACK).
 * Passes a connected client; use `client.query` for all statements in the transaction.
 */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
