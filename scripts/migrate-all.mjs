import { getMigrations } from "better-auth/db/migration";
import { auth, database } from "../auth.mjs";
import { applyCoupleMigrations, withMigrationLock } from "./database-migrations.mjs";

try {
  if (!database || !auth) throw new Error("Configure the database and Google authentication before running migrations.");
  await withMigrationLock(database, async (client) => {
    const migration = await getMigrations(auth.options);
    if (migration.schemaProblems.length || migration.unsafeChanges.length) {
      throw new Error("Authentication schema needs manual review; automatic migration stopped.");
    }
    await migration.runMigrations();
    console.log("Authentication schema is current.");
    await applyCoupleMigrations(client);
  });
} finally {
  if (database) await database.end();
}
