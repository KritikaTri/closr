import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const directory = new URL("../db/migrations/", import.meta.url);

export async function withMigrationLock(pool, migrate) {
  if (pool.options.max < 2) throw new Error("Migrations need DATABASE_POOL_SIZE of at least 2 for the schema lock and migration queries.");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('closer-schema-migrations'))");
    await migrate(client);
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('closer-schema-migrations'))"); }
    finally { client.release(); }
  }
}

export async function applyCoupleMigrations(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS closer_schema_migrations (
    name text PRIMARY KEY,
    sha256 char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(directory)).filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query("SELECT sha256 FROM closer_schema_migrations WHERE name = $1", [file]);
    if (previous.rowCount) {
      if (previous.rows[0].sha256 !== checksum) throw new Error(`Previously applied migration changed: ${file}. Add a new migration instead.`);
      console.log(`Already applied ${file}.`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO closer_schema_migrations (name, sha256) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${file}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(`Closer schema is current (${files.length} migrations).`);
}
