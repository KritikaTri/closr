import { betterAuth } from "better-auth";
import { Pool } from "pg";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const hasAuthConfig = Boolean(
  process.env.DATABASE_URL &&
  process.env.BETTER_AUTH_SECRET &&
  process.env.BETTER_AUTH_URL &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET,
);

export const authRequired = process.env.AUTH_REQUIRED === "true" ||
  (process.env.AUTH_REQUIRED !== "false" && (process.env.NODE_ENV === "production" || hasAuthConfig));

const databasePoolSize = Number(process.env.DATABASE_POOL_SIZE || 10);
if (!Number.isInteger(databasePoolSize) || databasePoolSize < 1 || databasePoolSize > 100) {
  throw new Error("DATABASE_POOL_SIZE must be an integer from 1 through 100.");
}

if (process.env.NODE_ENV === "production" && process.env.AUTH_REQUIRED === "false") {
  throw new Error("AUTH_REQUIRED=false is not allowed in production.");
}

export const database = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: databasePoolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      maxLifetimeSeconds: Number(process.env.DATABASE_CONNECTION_MAX_LIFETIME_SECONDS || 1_800),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    })
  : null;

export const auth = hasAuthConfig
  ? betterAuth({
      database,
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      trustedOrigins: (process.env.APP_ORIGINS || process.env.BETTER_AUTH_URL)
        .split(",").map((origin) => origin.trim()).filter(Boolean),
      socialProviders: {
        google: {
          clientId: [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean),
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      },
      session: {
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
      },
      advanced: {
        useSecureCookies: process.env.NODE_ENV === "production",
        defaultCookieAttributes: process.env.NODE_ENV === "production"
          ? { secure: true, sameSite: "none" }
          : undefined,
      },
    })
  : null;

export const authConfigured = Boolean(auth);
