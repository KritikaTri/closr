import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env before applying the couple-space migration.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
try {
  const migration = await readFile(resolve("db/migrations/0001_couple_space.sql"), "utf8");
  await pool.query(migration);
  console.log("Couple-space tables are ready.");
} finally {
  await pool.end();
}
