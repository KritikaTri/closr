import { Pool } from "pg";
import { applyCoupleMigrations, withMigrationLock } from "./database-migrations.mjs";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env before applying the couple-space migration.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
try { await withMigrationLock(pool, applyCoupleMigrations); }
finally { await pool.end(); }
