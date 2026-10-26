import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { importPKCS8, SignJWT } from "jose";

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
export const appleConfigured = Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);

async function appleClientSecret() {
  const key = await importPKCS8(process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"), "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID)
    .setSubject(process.env.APPLE_CLIENT_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 180 * 24 * 60 * 60)
    .sign(key);
}

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
        .split(",").map((origin) => origin.trim()).filter(Boolean)
        .concat(appleConfigured ? ["https://appleid.apple.com"] : []),
      socialProviders: {
        google: {
          clientId: [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean),
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
        ...(appleConfigured ? {
          apple: async () => ({
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: await appleClientSecret(),
            appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER || "com.closer.couples",
          }),
        } : {}),
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
