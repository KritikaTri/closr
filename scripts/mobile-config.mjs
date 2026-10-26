import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function mobileEnvironment() {
  // Only public routing/client IDs are allowed in this file. Server secrets
  // belong in Secret Manager and are never needed to package the phone app.
  try { process.loadEnvFile?.(resolve(root, ".env.mobile")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const profile = JSON.parse(await readFile(resolve(root, "mobile/staging.json"), "utf8"));
  return {
    ...process.env,
    CLOSER_API_BASE_URL: process.env.CLOSER_API_BASE_URL || profile.apiBaseUrl,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || profile.googleWebClientId,
  };
}
