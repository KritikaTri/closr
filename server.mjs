import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { Storage } from "@google-cloud/storage";
import { createJournalApi } from "./journal.mjs";
import { createRecordingsApi } from "./recordings.mjs";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const { auth, authConfigured, appleConfigured, authRequired, database } = await import("./auth.mjs");
const mediaBucket = process.env.GCS_BUCKET ? new Storage().bucket(process.env.GCS_BUCKET) : null;

const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".tgz": "application/gzip", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const trustedOrigins = new Set((process.env.APP_ORIGINS || process.env.BETTER_AUTH_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:4173,http://127.0.0.1:4173"))
  .split(",").map((origin) => origin.trim()).filter(Boolean));
if (appleConfigured) trustedOrigins.add("https://appleid.apple.com");
const rateBuckets = new Map();

if (process.env.NODE_ENV === "production") {
  const missing = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GCS_BUCKET"]
    .filter((key) => !process.env[key]);
  if (missing.length || !auth || !database || !authRequired) {
    throw new Error(`Production requires PostgreSQL and Google authentication configuration. Missing: ${missing.join(", ") || "valid auth setup"}.`);
  }
  const appUrl = new URL(process.env.BETTER_AUTH_URL);
  if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("BETTER_AUTH_URL must be an HTTPS origin without credentials, a path, or query parameters.");
  }
  if (process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  const appleKeys = ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"];
  if ((appleKeys.some((key) => process.env[key]) || process.env.REQUIRE_APPLE_SIGN_IN === "true") && !appleConfigured) {
    throw new Error("Complete all Apple sign-in credentials before enabling Apple sign-in.");
  }
}

function send(response, status, payload, contentType = "application/json; charset=utf-8") {
  const connectSources = ["'self'", ...trustedOrigins].map((origin) => {
    if (origin === "'self'") return origin;
    try { return new URL(origin).origin; } catch { return null; }
  }).filter(Boolean);
  if (process.env.BETTER_AUTH_URL) {
    try { connectSources.push(new URL(process.env.BETTER_AUTH_URL).origin); } catch {}
  }
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
    "Content-Security-Policy": `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.googleusercontent.com https://storage.googleapis.com; media-src 'self' blob: https://storage.googleapis.com; connect-src ${[...new Set(connectSources)].join(" ")}`,
  });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(payload) : payload);
}

function applyApiCors(request, response) {
  if (!new URL(request.url, `http://${host}:${port}`).pathname.startsWith("/api/")) return true;
  const origin = request.headers.origin;
  response.setHeader("Vary", "Origin");
  if (origin) {
    if (!trustedOrigins.has(origin)) return false;
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    response.setHeader("Access-Control-Max-Age", "600");
  }
  return true;
}

function allowRequest(key, limit, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 5_000) {
    for (const [bucketKey, value] of rateBuckets) if (now - value.startedAt > windowMs * 2) rateBuckets.delete(bucketKey);
  }
  return bucket.count <= limit;
}

async function readJson(request, limit = 24_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error("Request must contain a JSON object."); }
}

async function readBytes(request, limit, tooLargeMessage = "Audio recording is too large. Keep the voice command short and try again.") {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error(tooLargeMessage);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function hashInvite(token) {
  return createHash("sha256").update(token).digest("hex");
}

function inviteTokenFor(id) {
  // Regenerate an owned invitation without storing its bearer token in the DB.
  // The dedicated context separates this HMAC from authentication uses of the key.
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET)
    .update(`closr/partner-invite/v1\0${id}`).digest("base64url");
  return `${id}.${signature}`;
}

function inviteDetails(invite, token) {
  const link = new URL("/login.html", process.env.BETTER_AUTH_URL);
  link.searchParams.set("invite", token);
  return { token, inviteUrl: link.href, expiresAt: invite.expires_at.toISOString(), expiresInDays: Math.max(1, Math.ceil((invite.expires_at.getTime() - Date.now()) / 86_400_000)) };
}

function hasImageSignature(bytes, contentType) {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

async function signedMediaUrl(objectPath) {
  if (!mediaBucket || !objectPath) return null;
  const [url] = await mediaBucket.file(objectPath).getSignedUrl({
    version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

async function removeMediaAsset(mediaId) {
  if (!mediaId) return;
  const result = await database.query("SELECT object_path FROM memory_media_assets WHERE id = $1", [mediaId]);
  const objectPath = result.rows[0]?.object_path;
  if (objectPath && mediaBucket) {
    try { await mediaBucket.file(objectPath).delete({ ignoreNotFound: true }); }
    catch (error) { console.error("Could not remove a memory photo from cloud storage:", error.message); return; }
  }
  await database.query("DELETE FROM memory_media_assets WHERE id = $1", [mediaId]);
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function currentSession(request) {
  if (!auth) return null;
  return auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
}

async function signedInUser(request, response) {
  if (!auth || !database) {
    send(response, 503, { error: "Authentication is not configured. Follow the Google sign-in setup in README.md." });
    return null;
  }
  const session = await currentSession(request);
  if (!session?.user) {
    send(response, 401, { error: "Sign in with Google to continue." });
    return null;
  }
  return session.user;
}

async function coupleForUser(userId) {
  const result = await database.query(
    `SELECT c.id, c.name, cm.joined_at,
            EXISTS (SELECT 1 FROM couple_members other WHERE other.couple_id = c.id AND other.user_id <> $1) AS has_partner
       FROM couple_members cm JOIN couples c ON c.id = cm.couple_id
      WHERE cm.user_id = $1 LIMIT 1`, [userId],
  );
  return result.rows[0] || null;
}

async function memberProfile(userId) {
  const result = await database.query(
    `SELECT u.id, COALESCE(p.nickname, u.name) AS name, p.nickname, u.image
       FROM "user" u LEFT JOIN closer_profiles p ON p.user_id = u.id
      WHERE u.id = $1`, [userId],
  );
  return result.rows[0] || null;
}

async function coupleSnapshot(coupleId, userId) {
  const [members, statuses, messages, closerMessages, pings] = await Promise.all([
    database.query(
      `SELECT u.id, COALESCE(p.nickname, u.name) AS name, p.nickname, u.image, cm.joined_at
         FROM couple_members cm JOIN "user" u ON u.id = cm.user_id
         LEFT JOIN closer_profiles p ON p.user_id = u.id
        WHERE cm.couple_id = $1 ORDER BY cm.joined_at`, [coupleId],
    ),
    database.query(
      `SELECT user_id, status, custom_message, expires_at, updated_at
         FROM couple_statuses WHERE couple_id = $1`, [coupleId],
    ),
    database.query(
      `SELECT id, sender_id, body, created_at FROM (
         SELECT id, sender_id, body, created_at FROM couple_messages
          WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 500
       ) recent ORDER BY created_at`, [coupleId],
    ),
    database.query(
      `SELECT id, sender_id, role, body, created_at FROM (
         SELECT id, sender_id, role, body, created_at FROM couple_closer_messages
          WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 200
       ) recent ORDER BY created_at`, [coupleId],
    ),
    database.query(
      `SELECT id, sender_id, recipient_id, created_at, acknowledged_at FROM couple_pings
        WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 100`, [coupleId],
    ),
  ]);
  return {
    couple: { id: coupleId, name: "Our space" },
    self: members.rows.find((member) => member.id === userId),
    partner: members.rows.find((member) => member.id !== userId) || null,
    statuses: statuses.rows.map((status) => ({
      userId: status.user_id, status: status.status, customMessage: status.custom_message,
      expiresAt: status.expires_at?.getTime() || null, updatedAt: status.updated_at.getTime(),
    })),
    messages: messages.rows.map((message) => ({
      id: message.id, senderId: message.sender_id, text: message.body, createdAt: message.created_at.getTime(),
    })),
    closerMessages: closerMessages.rows.map((message) => ({
      id: message.id, senderId: message.sender_id, role: message.role, text: message.body, createdAt: message.created_at.getTime(),
    })),
    pings: pings.rows.map((ping) => ({
      id: ping.id, senderId: ping.sender_id, recipientId: ping.recipient_id,
      createdAt: ping.created_at.getTime(), acknowledgedAt: ping.acknowledged_at?.getTime() || null,
    })),
  };
}

async function handleSharedCloserChat(request, response, user, method) {
  const couple = await coupleForUser(user.id);
  if (!couple?.has_partner) { send(response, 409, { error: "Connect your partner to open a shared Closr conversation. Your private chat is available on your own." }); return; }
  if (method === "GET") {
    const result = await database.query(
      `SELECT id, sender_id, role, body, created_at FROM (
         SELECT id, sender_id, role, body, created_at FROM couple_closer_messages
          WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 200
       ) recent ORDER BY created_at`, [couple.id],
    );
    send(response, 200, { messages: result.rows.map((row) => ({
      id: row.id, senderId: row.sender_id, role: row.role, text: row.body, createdAt: row.created_at.getTime(),
    })) });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    send(response, 503, { error: "Closr’s AI isn’t available yet. Your partner chat and statuses are still available." });
    return;
  }
  let body;
  try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return; }
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 1200) {
    send(response, 400, { error: "Messages must be between 1 and 1,200 characters." }); return;
  }
  const partnerResult = await database.query(
    `SELECT COALESCE(p.nickname, u.name) AS name FROM couple_members cm JOIN "user" u ON u.id = cm.user_id
      LEFT JOIN closer_profiles p ON p.user_id = u.id
      WHERE cm.couple_id = $1 AND cm.user_id <> $2 LIMIT 1`, [couple.id, user.id],
  );
  const statusResult = await database.query(
    `SELECT status, custom_message FROM couple_statuses
      WHERE couple_id = $1 AND user_id <> $2 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`, [couple.id, user.id],
  );
  const sharedMemoryResult = await database.query(
    `SELECT body FROM couple_memories
      WHERE couple_id = $1 AND kind = 'shared_note'
      ORDER BY created_at DESC LIMIT 20`, [couple.id],
  );
  const partnerStatus = statusResult.rows[0];
  const recent = await database.query(
    `SELECT role, body, sender_id, sender_name FROM (
       SELECT m.role, m.body, m.sender_id, COALESCE(p.nickname, u.name) AS sender_name, m.created_at FROM couple_closer_messages m
        LEFT JOIN "user" u ON u.id = m.sender_id
        LEFT JOIN closer_profiles p ON p.user_id = u.id WHERE m.couple_id = $1
        ORDER BY created_at DESC LIMIT 18
     ) recent ORDER BY created_at`, [couple.id],
  );
  const profile = await memberProfile(user.id);
  const history = [...recent.rows, { role: "user", body: body.text.trim(), sender_name: profile?.name || "A partner" }];
  if (!allowRequest(`shared-ai:${user.id}`, 12, 60_000)) {
    send(response, 429, { error: "Let’s take a short pause before sending another Closr message." });
    return;
  }
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      max_output_tokens: 400,
      instructions: instructionsFor({
        scope: "shared",
        partnerName: partnerResult.rows[0]?.name || "your partner",
        partnerStatus: partnerStatus?.status || "unknown",
        partnerCustomMessage: partnerStatus?.custom_message || "",
        sharedMemories: sharedMemoryResult.rows.map((row) => row.body),
      }),
      input: history.map((item) => ({
        role: item.role,
        content: item.role === "user" ? `${item.sender_name || "A partner"} wrote: ${item.body}` : item.body,
      })),
      store: false,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!apiResponse) { send(response, 502, { error: "Could not reach the AI service. Try again." }); return; }
  const result = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    console.error(`OpenAI API returned HTTP ${apiResponse.status}.`);
    send(response, 502, { error: "Closr couldn’t get a reply right now. Try again in a moment." });
    return;
  }
  const reply = Array.isArray(result.output)
    ? result.output.flatMap((item) => Array.isArray(item.content) ? item.content : []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n").trim()
    : "";
  if (!reply) { send(response, 502, { error: "Closr didn’t receive a text reply. Please try again." }); return; }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO couple_closer_messages (id, couple_id, sender_id, role, body) VALUES ($1, $2, $3, 'user', $4)",
      [randomUUID(), couple.id, user.id, body.text.trim()],
    );
    await client.query(
      "INSERT INTO couple_closer_messages (id, couple_id, sender_id, role, body) VALUES ($1, $2, NULL, 'assistant', $3)",
      [randomUUID(), couple.id, reply],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const latest = await database.query(
    `SELECT id, sender_id, role, body, created_at FROM (
       SELECT id, sender_id, role, body, created_at FROM couple_closer_messages
        WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 200
     ) recent ORDER BY created_at`, [couple.id],
  );
  send(response, 200, { messages: latest.rows.map((row) => ({
    id: row.id, senderId: row.sender_id, role: row.role, text: row.body, createdAt: row.created_at.getTime(),
  })) });
}

async function handleAccountApi(request, response, pathname) {
  if (pathname === "/api/account/profile") {
    const user = await signedInUser(request, response);
    if (!user) return true;
    if (request.method === "GET") {
      send(response, 200, { profile: await memberProfile(user.id) });
      return true;
    }
    if (request.method !== "PATCH") { send(response, 405, { error: "Method not allowed." }); return true; }
    if (!allowRequest(`nickname:${user.id}`, 10, 60_000)) { send(response, 429, { error: "Wait a moment before changing your nickname again." }); return true; }
    let body;
    try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
    if (!Object.hasOwn(body, "nickname") || Object.keys(body).some((key) => key !== "nickname") || (body.nickname !== null && typeof body.nickname !== "string")) {
      send(response, 400, { error: "Choose a nickname, or reset it to your Google name." }); return true;
    }
    if (body.nickname === null) {
      await database.query("DELETE FROM closer_profiles WHERE user_id = $1", [user.id]);
    } else {
      const nickname = body.nickname.normalize("NFC").trim().replace(/\p{Zs}+/gu, " ");
      if (!nickname || Array.from(nickname).length > 40 || /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(nickname)) {
        send(response, 400, { error: "Use 1–40 characters for your nickname, without line breaks or control characters." }); return true;
      }
      await database.query(
        `INSERT INTO closer_profiles (user_id, nickname) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now()`, [user.id, nickname],
      );
    }
    send(response, 200, { profile: await memberProfile(user.id) });
    return true;
  }
  if (pathname !== "/api/account" || request.method !== "DELETE") return false;
  const user = await signedInUser(request, response);
  if (!user) return true;
  if (!allowRequest(`account-delete:${user.id}`, 2, 60_000)) { send(response, 429, { error: "Wait a moment before trying again." }); return true; }
  let body;
  try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
  if (body.confirmation !== "DELETE MY CLOSR ACCOUNT") {
    send(response, 400, { error: "Type the confirmation phrase to permanently delete this account." });
    return true;
  }
  const assets = await database.query(
    "SELECT object_path FROM memory_media_assets WHERE uploaded_by = $1 OR owner_user_id = $1 UNION ALL SELECT object_path FROM journal_recordings WHERE (uploaded_by=$1 OR owner_user_id=$1) AND object_path IS NOT NULL",
    [user.id],
  );
  if (assets.rowCount && !mediaBucket) {
    send(response, 503, { error: "Your media could not be deleted right now. Please try again later." });
    return true;
  }
  try {
    for (let offset = 0; offset < assets.rows.length; offset += 20) {
      await Promise.all(assets.rows.slice(offset, offset + 20).map(({ object_path }) => mediaBucket.file(object_path).delete({ ignoreNotFound: true })));
    }
  } catch (error) {
    console.error("Account deletion stopped because media cleanup failed:", error.message);
    send(response, 503, { error: "Your account wasn’t deleted because media cleanup failed. Please try again later." });
    return true;
  }
  const result = await database.query('DELETE FROM "user" WHERE id = $1 RETURNING id', [user.id]);
  if (!result.rowCount) { send(response, 404, { error: "This account could not be found." }); return true; }
  send(response, 200, { ok: true });
  return true;
}

async function handleCoupleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/config") {
    send(response, 200, { authConfigured, appleConfigured, authRequired, aiConfigured: Boolean(process.env.OPENAI_API_KEY), photoStorageConfigured: Boolean(mediaBucket) });
    return true;
  }
  if (!pathname.startsWith("/api/couple")) return false;
  const user = await signedInUser(request, response);
  if (!user) return true;
  if (request.method !== "GET" && pathname !== "/api/couple/media" && !allowRequest(`couple:${user.id}`, 90, 60_000)) {
    send(response, 429, { error: "You’re doing that a little quickly. Wait a moment and try again." });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple/media") {
    if (!mediaBucket) { send(response, 503, { error: "Photo storage is not configured on this server yet." }); return true; }
    if (!allowRequest(`memory-photo:${user.id}`, 120, 60_000)) { send(response, 429, { error: "You’re adding photos quickly. Wait a minute and try again." }); return true; }
    const scope = new URL(request.url, `http://${host}:${port}`).searchParams.get("scope");
    const contentType = (request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) { send(response, 415, { error: "Choose a JPEG, PNG, or WebP photo." }); return true; }
    let couple = null;
    if (scope === "shared") {
      couple = await coupleForUser(user.id);
      if (!couple?.has_partner) { send(response, 409, { error: "Connect your partner before adding a shared photo. You can add private journal photos on your own." }); return true; }
    } else if (scope !== "private") { send(response, 400, { error: "Choose a shared or private photo location." }); return true; }
    let bytes;
    try { bytes = await readBytes(request, 1_258_291, "That photo is too large after compression. Choose a smaller image."); }
    catch (error) { send(response, 413, { error: error.message }); return true; }
    if (!bytes.length || !hasImageSignature(bytes, contentType)) { send(response, 400, { error: "That file doesn’t look like a supported image." }); return true; }
    const id = randomUUID();
    const objectPath = scope === "shared" ? `couples/${couple.id}/${id}` : `private/${user.id}/${id}`;
    const file = mediaBucket.file(objectPath);
    try {
      await file.save(bytes, { resumable: false, metadata: { contentType, cacheControl: "private, max-age=0, no-transform" } });
      await database.query(
        `INSERT INTO memory_media_assets (id, couple_id, owner_user_id, uploaded_by, object_path, content_type, byte_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, couple?.id || null, scope === "private" ? user.id : null, user.id, objectPath, contentType, bytes.length],
      );
      send(response, 201, { mediaId: id });
    } catch (error) {
      await file.delete({ ignoreNotFound: true }).catch(() => {});
      throw error;
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/couple") {
    const couple = await coupleForUser(user.id);
    if (!couple) send(response, 200, {
      couple: null, self: await memberProfile(user.id), partner: null,
      statuses: [], messages: [], closerMessages: [], pings: [],
    });
    else send(response, 200, await coupleSnapshot(couple.id, user.id));
    return true;
  }

  if (pathname === "/api/couple/memories" && request.method === "GET") {
    const couple = await coupleForUser(user.id);
    const [shared, personal] = await Promise.all([
      couple ? database.query(
        `SELECT m.id, m.kind, m.title, m.entry_date, m.folder, m.body, m.created_at, a.object_path
           FROM couple_memories m LEFT JOIN memory_media_assets a ON a.id = m.media_id
          WHERE m.couple_id = $1
          ORDER BY m.entry_date DESC, m.created_at DESC`, [couple.id],
      ) : Promise.resolve({ rows: [] }),
      database.query(
        `SELECT j.id, j.feeling, j.entry_date, j.body, j.created_at, a.object_path
           FROM private_journal_entries j LEFT JOIN memory_media_assets a ON a.id = j.media_id
          WHERE j.owner_user_id = $1
          ORDER BY j.entry_date DESC, j.created_at DESC`, [user.id],
      ),
    ]);
    send(response, 200, {
      shared: await Promise.all(shared.rows.map(async (row) => ({ id: row.id, kind: row.kind, title: row.title, date: String(row.entry_date).slice(0, 10), folder: row.folder, body: row.body, image: await signedMediaUrl(row.object_path), createdAt: row.created_at.getTime() }))),
      personal: await Promise.all(personal.rows.map(async (row) => ({ id: row.id, feeling: row.feeling, date: String(row.entry_date).slice(0, 10), body: row.body, image: await signedMediaUrl(row.object_path), createdAt: row.created_at.getTime() }))),
    });
    return true;
  }

  if (pathname === "/api/couple/memories" && request.method === "POST") {
    let body;
    try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
    const kinds = new Set(["important_date", "shared_journal", "shared_note"]);
    if (body.kind !== "shared_note") { send(response, 409, { error: "Your journal has a new editor. Reload Closr to save this memory there." }); return true; }
    const validDate = isDateOnly(body.date);
    const maxBody = body.kind === "shared_note" ? 240 : 3000;
    if (!kinds.has(body.kind) || !validDate || typeof body.body !== "string" || (body.kind !== "important_date" && !body.body.trim()) || body.body.length > maxBody ||
        typeof body.title !== "string" || body.title.length > 100 ||
        (body.kind !== "shared_note" && !body.title.trim()) ||
        (body.kind === "shared_journal" && (typeof body.folder !== "string" || body.folder.length > 40))) {
      send(response, 400, { error: "Check the title, date, folder, and entry length, then try again." }); return true;
    }
    const couple = await coupleForUser(user.id);
    if (!couple?.has_partner) { send(response, 409, { error: "Connect your partner before saving shared memories. Your private journal is available on your own." }); return true; }
    let mediaId = null;
    if (body.mediaId) {
      if (body.kind === "shared_note" || !isUuid(body.mediaId)) { send(response, 400, { error: "That photo can’t be attached to this entry." }); return true; }
      const asset = await database.query("SELECT object_path, byte_size, content_type FROM memory_media_assets WHERE id = $1 AND couple_id = $2 AND uploaded_by = $3", [body.mediaId, couple.id, user.id]);
      const object = asset.rows[0];
      if (!object) { send(response, 404, { error: "That shared photo wasn’t found." }); return true; }
      const [metadata] = await mediaBucket.file(object.object_path).getMetadata();
      if (Number(metadata.size) !== object.byte_size || metadata.contentType !== object.content_type) { send(response, 409, { error: "The photo upload is incomplete. Please choose it again." }); return true; }
      mediaId = body.mediaId;
    }
    const id = randomUUID();
    const folder = body.kind === "shared_journal" ? (body.folder.trim() || "Unsorted") : null;
    const result = await database.query(
      `INSERT INTO couple_memories (id, couple_id, created_by, kind, title, entry_date, folder, body, media_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
       RETURNING id, kind, title, entry_date, folder, body, created_at`,
      [id, couple.id, user.id, body.kind, body.title.trim(), body.date, folder, body.body.trim(), mediaId],
    );
    const row = result.rows[0];
    send(response, 201, { entry: { id: row.id, kind: row.kind, title: row.title, date: String(row.entry_date).slice(0, 10), folder: row.folder, body: row.body, createdAt: row.created_at.getTime() } });
    return true;
  }

  if (pathname === "/api/couple/private-journal" && request.method === "POST") {
    send(response, 409, { error: "Your journal has a new editor. Reload Closr to save your private page there." }); return true;
  }

  const sharedMemoryDelete = pathname.match(/^\/api\/couple\/memories\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && sharedMemoryDelete) {
    const couple = await coupleForUser(user.id);
    if (!couple) { send(response, 409, { error: "Pair your account before editing shared memories." }); return true; }
    const result = await database.query("DELETE FROM couple_memories WHERE id = $1 AND couple_id = $2 AND kind = 'shared_note' RETURNING id, media_id", [sharedMemoryDelete[1], couple.id]);
    if (!result.rowCount) { send(response, 404, { error: "That shared entry wasn’t found." }); return true; }
    await removeMediaAsset(result.rows[0].media_id);
    send(response, 200, { ok: true });
    return true;
  }

  const privateJournalDelete = pathname.match(/^\/api\/couple\/private-journal\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && privateJournalDelete) {
    send(response, 409, { error: "Reload Closr to move this entry to the new journal’s recoverable trash." }); return true;
  }

  if (pathname === "/api/couple/closer-chat" && ["GET", "POST"].includes(request.method)) {
    await handleSharedCloserChat(request, response, user, request.method);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple") {
    const existing = await coupleForUser(user.id);
    if (existing) { send(response, 409, { error: "You are already in a couple space." }); return true; }
    const client = await database.connect();
    const coupleId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO couples (id) VALUES ($1)", [coupleId]);
      await client.query("INSERT INTO couple_members (couple_id, user_id) VALUES ($1, $2)", [coupleId, user.id]);
      await client.query("COMMIT");
      send(response, 201, await coupleSnapshot(coupleId, user.id));
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") send(response, 409, { error: "This account already belongs to a couple space." });
      else throw error;
    } finally { client.release(); }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple/invites/preview") {
    let body;
    try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
    if (typeof body.token !== "string" || body.token.length < 30 || body.token.length > 200) {
      send(response, 400, { error: "That invite link doesn’t look valid." }); return true;
    }
    const result = await database.query(
      `SELECT COALESCE(p.nickname, u.name) AS inviter_name, i.created_by, i.expires_at
         FROM couple_invites i JOIN "user" u ON u.id = i.created_by
         JOIN couple_members cm ON cm.couple_id = i.couple_id AND cm.user_id = i.created_by
         LEFT JOIN closer_profiles p ON p.user_id = u.id
        WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
          AND (SELECT count(*) FROM couple_members WHERE couple_id = i.couple_id) = 1`, [hashInvite(body.token)],
    );
    const invite = result.rows[0];
    if (!invite) { send(response, 410, { error: "This invitation has expired or was already used. Ask your partner to send a new link." }); return true; }
    send(response, 200, { inviterName: invite.inviter_name, isInviter: invite.created_by === user.id, expiresAt: invite.expires_at.toISOString() });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple/invites") {
    const couple = await coupleForUser(user.id);
    if (!couple) { send(response, 409, { error: "Create your private space before inviting your partner." }); return true; }
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM couples WHERE id = $1 FOR UPDATE", [couple.id]);
      const size = await client.query("SELECT count(*)::int AS count FROM couple_members WHERE couple_id = $1", [couple.id]);
      if (size.rows[0].count >= 2) {
        await client.query("ROLLBACK"); send(response, 409, { error: "This space already has two people." }); return true;
      }
      const pending = await client.query(
        `SELECT id, token_hash, expires_at FROM couple_invites
          WHERE couple_id = $1 AND created_by = $2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1`, [couple.id, user.id],
      );
      if (pending.rowCount) {
        const token = inviteTokenFor(pending.rows[0].id);
        if (hashInvite(token) === pending.rows[0].token_hash) {
          await client.query("COMMIT");
          send(response, 200, inviteDetails(pending.rows[0], token));
          return true;
        }
      }
      // Preserve any older random-token invitation until it expires or is used.
      // Opening the share dialog must not invalidate a link already sent.
      const id = randomUUID();
      const token = inviteTokenFor(id);
      const inserted = await client.query(
        "INSERT INTO couple_invites (id, couple_id, created_by, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING expires_at",
        [id, couple.id, user.id, hashInvite(token)],
      );
      await client.query("COMMIT");
      send(response, 201, inviteDetails(inserted.rows[0], token));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple/accept") {
    let body;
    try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
    if (typeof body.token !== "string" || body.token.length < 30 || body.token.length > 200) {
      send(response, 400, { error: "That invite link doesn’t look valid." }); return true;
    }
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const inviteResult = await client.query(
        `SELECT id, couple_id FROM couple_invites
          WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [hashInvite(body.token)],
      );
      let invite = inviteResult.rows[0];
      if (!invite) {
        await client.query("ROLLBACK");
        send(response, 410, { error: "This invite has expired or was already used. Ask your partner for a fresh link." });
        return true;
      }
      const previousMembership = await client.query("SELECT couple_id FROM couple_members WHERE user_id = $1", [user.id]);
      const lockIds = [...new Set([invite.couple_id, previousMembership.rows[0]?.couple_id].filter(Boolean))].sort();
      await client.query("SELECT id FROM couples WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [lockIds]);
      const lockedInvite = await client.query(
        `SELECT id, couple_id FROM couple_invites
          WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [invite.id],
      );
      invite = lockedInvite.rows[0];
      if (!invite) {
        await client.query("ROLLBACK");
        send(response, 410, { error: "This invite has expired or was already used. Ask your partner for a fresh link." });
        return true;
      }
      const membership = await client.query("SELECT count(*)::int AS count FROM couple_members WHERE couple_id = $1", [invite.couple_id]);
      if (membership.rows[0].count >= 2) {
        await client.query("ROLLBACK"); send(response, 409, { error: "This couple space already has two members." }); return true;
      }
      const alreadyInSpace = await client.query("SELECT couple_id FROM couple_members WHERE user_id = $1", [user.id]);
      let previousStatus = null;
      if (alreadyInSpace.rowCount) {
        const previousId = alreadyInSpace.rows[0].couple_id;
        if (previousId === invite.couple_id) {
          await client.query("ROLLBACK"); send(response, 409, { error: "You already belong to this space. Share your invite with your partner, or open Closr from your home screen." }); return true;
        }
        // Both people may have created an invite independently. Retire only an
        // unused one-person space; private journals belong to the user and stay.
        const previous = await client.query(
          `SELECT (SELECT count(*) FROM couple_members WHERE couple_id = $1) AS members,
             EXISTS (SELECT 1 FROM couple_memories WHERE couple_id = $1)
             OR EXISTS (SELECT 1 FROM couple_messages WHERE couple_id = $1)
             OR EXISTS (SELECT 1 FROM couple_closer_messages WHERE couple_id = $1)
             OR EXISTS (SELECT 1 FROM journal_pages WHERE couple_id = $1)
             OR EXISTS (SELECT 1 FROM memory_media_assets WHERE couple_id = $1) AS has_content`, [previousId],
        );
        if (Number(previous.rows[0].members) !== 1 || previous.rows[0].has_content) {
          await client.query("ROLLBACK"); send(response, 409, { error: "This account already has a connected or saved shared space. It can’t be replaced by this invitation." }); return true;
        }
        previousStatus = (await client.query("SELECT status, custom_message, expires_at FROM couple_statuses WHERE couple_id = $1 AND user_id = $2", [previousId, user.id])).rows[0];
        await client.query("DELETE FROM couple_members WHERE couple_id = $1 AND user_id = $2", [previousId, user.id]);
        await client.query("DELETE FROM couples WHERE id = $1", [previousId]);
      }
      await client.query("INSERT INTO couple_members (couple_id, user_id) VALUES ($1, $2)", [invite.couple_id, user.id]);
      if (previousStatus) await client.query(
        "INSERT INTO couple_statuses (couple_id, user_id, status, custom_message, expires_at) VALUES ($1, $2, $3, $4, $5)",
        [invite.couple_id, user.id, previousStatus.status, previousStatus.custom_message, previousStatus.expires_at],
      );
      await client.query("UPDATE couple_invites SET used_at = now() WHERE id = $1", [invite.id]);
      await client.query("UPDATE couple_invites SET revoked_at = now() WHERE couple_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [invite.couple_id]);
      await client.query("COMMIT");
      send(response, 200, await coupleSnapshot(invite.couple_id, user.id));
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") send(response, 409, { error: "This account or couple space has already been paired." });
      else throw error;
    } finally { client.release(); }
    return true;
  }

  if (request.method === "PUT" && pathname === "/api/couple/status") {
    let body;
    try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
    if (!new Set(["open", "quiet", "away", "custom"]).has(body.status) || (body.status === "custom" && (typeof body.customMessage !== "string" || !body.customMessage.trim() || body.customMessage.length > 120))) {
      send(response, 400, { error: "Choose a valid status and keep custom messages under 120 characters." }); return true;
    }
    const couple = await coupleForUser(user.id);
    if (!couple) { send(response, 409, { error: "Pair your account before sharing a status." }); return true; }
    const expiresAt = Number.isFinite(body.expiresAt) ? new Date(body.expiresAt) : null;
    await database.query(
      `INSERT INTO couple_statuses (couple_id, user_id, status, custom_message, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (couple_id, user_id) DO UPDATE SET status = EXCLUDED.status,
         custom_message = EXCLUDED.custom_message, expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [couple.id, user.id, body.status, body.status === "custom" ? body.customMessage.trim() : "", expiresAt],
    );
    send(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple/pings") {
    const couple = await coupleForUser(user.id);
    if (!couple) { send(response, 409, { error: "Pair your account before sending a gentle ping." }); return true; }
    const partnerResult = await database.query("SELECT user_id FROM couple_members WHERE couple_id = $1 AND user_id <> $2 LIMIT 1", [couple.id, user.id]);
    const partnerId = partnerResult.rows[0]?.user_id;
    if (!partnerId) { send(response, 409, { error: "Your partner hasn’t joined this space yet." }); return true; }
    const pingId = randomUUID();
    const inserted = await database.query(
      `INSERT INTO couple_pings (id, couple_id, sender_id, recipient_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (couple_id, sender_id, recipient_id) WHERE acknowledged_at IS NULL DO NOTHING
       RETURNING id`, [pingId, couple.id, user.id, partnerId],
    );
    const current = inserted.rows[0] || (await database.query(
      "SELECT id FROM couple_pings WHERE couple_id = $1 AND sender_id = $2 AND recipient_id = $3 AND acknowledged_at IS NULL",
      [couple.id, user.id, partnerId],
    )).rows[0];
    send(response, 200, { id: current.id });
    return true;
  }

  const pingAck = pathname.match(/^\/api\/couple\/pings\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && pingAck) {
    const couple = await coupleForUser(user.id);
    if (!couple) { send(response, 409, { error: "Pair your account before acknowledging pings." }); return true; }
    const result = await database.query(
      "UPDATE couple_pings SET acknowledged_at = now() WHERE id = $1 AND couple_id = $2 AND recipient_id = $3 RETURNING id",
      [pingAck[1], couple.id, user.id],
    );
    if (!result.rowCount) { send(response, 404, { error: "That ping wasn’t found." }); return true; }
    send(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/couple/messages") {
    const couple = await coupleForUser(user.id);
    if (!couple?.has_partner) { send(response, 409, { error: "Connect your partner before chatting together." }); return true; }
    const result = await database.query(
      `SELECT id, sender_id, body, created_at FROM (
         SELECT id, sender_id, body, created_at FROM couple_messages WHERE couple_id = $1
          ORDER BY created_at DESC LIMIT 500
       ) recent ORDER BY created_at`, [couple.id],
    );
    send(response, 200, { messages: result.rows.map((row) => ({ id: row.id, senderId: row.sender_id, text: row.body, createdAt: row.created_at.getTime() })) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/couple/messages") {
    let body;
    try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return true; }
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 2000) { send(response, 400, { error: "Messages must be between 1 and 2,000 characters." }); return true; }
    const couple = await coupleForUser(user.id);
    if (!couple?.has_partner) { send(response, 409, { error: "Connect your partner before chatting together." }); return true; }
    await database.query("INSERT INTO couple_messages (id, couple_id, sender_id, body) VALUES ($1, $2, $3, $4)", [randomUUID(), couple.id, user.id, body.text.trim()]);
    send(response, 201, { ok: true });
    return true;
  }

  send(response, 404, { error: "Couple endpoint not found." });
  return true;
}

function instructionsFor({ scope, partnerName, partnerStatus, partnerCustomMessage, sharedMemories, hasPartner = true }) {
  if (!hasPartner) return "You are Closr, a warm, grounded reflection companion. This person has not connected a partner. Help them explore their own feelings, communication, and everyday experiences. Do not assume they are in a relationship, invent a partner or shared history, or pressure them to invite anyone. Ask one gentle question at a time. Respect their autonomy. Do not diagnose anyone, present yourself as a therapist, or promise relationship outcomes. This is their private conversation; never turn its contents into shared memory.";
  const memoryList = sharedMemories.length ? sharedMemories.map((memory) => `- ${memory}`).join("\n") : "No shared memories have been saved.";
  const statusText = partnerStatus === "open" ? `${partnerName} marked themself open to a chat.`
    : partnerStatus === "quiet" ? `${partnerName} marked themself as taking quiet.`
      : partnerStatus === "away" ? `${partnerName} marked themself away.`
        : partnerStatus === "custom" ? `${partnerName} shared this custom status: “${partnerCustomMessage}”.`
          : `There is no current check-in from ${partnerName}.`;
  const privacy = scope === "private"
    ? "This is the user's private conversation. Do not reveal it to the partner, claim the partner can see it, or suggest writing private details into shared memory without clearly asking permission. Only the current user's private history is in this request."
    : "This is the couple's shared conversation. Both partners can read every message. Speak to both with care and do not assume one person's account is complete.";
  return `You are Closr, a warm and grounded conversation companion for a couple. Help the person reflect on what they wanted to say, understand what they need, and choose considerate words or timing. Ask one gentle question at a time. Respect both people's autonomy and the status they explicitly set. Never pressure someone to respond, help bypass an unavailable status, send messages, or decide who is right. Do not present yourself as a therapist or promise to save a relationship. Avoid diagnosing either person or making claims about their motives. Be balanced and practical; encourage direct, kind communication when it feels appropriate.\n\nConversation mode: ${scope}. ${privacy}\nPartner's explicitly shared status: ${statusText}\nShared memories visible to both partners:\n${memoryList}\n\nUse shared memories as helpful context, not as proof or a permanent personality profile. If a memory sounds outdated or disputed, invite the couple to update it. Do not turn private conversation content into shared memory.`;
}

async function handleChat(request, response, signedIn = null) {
  if (!process.env.OPENAI_API_KEY) {
    send(response, 503, { error: "Closr’s AI isn’t available yet. Your partner chat and statuses are still available." });
    return;
  }
  let body;
  try { body = await readJson(request); } catch (error) { send(response, 400, { error: error.message }); return; }
  const allowedScopes = new Set(["private", "shared"]);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!allowedScopes.has(body.scope) || !messages.length || messages.some((message) => !["user", "assistant"].includes(message?.role) || typeof message.content !== "string" || message.content.length > 1200)) {
    send(response, 400, { error: "The chat request is invalid." });
    return;
  }
  const sharedMemories = Array.isArray(body.sharedMemories)
    ? body.sharedMemories.filter((memory) => typeof memory === "string").slice(0, 8).map((memory) => memory.slice(0, 240))
    : [];
  let partnerName = typeof body.partnerName === "string" ? body.partnerName.slice(0, 40) : "your partner";
  let partnerStatus = ["open", "quiet", "away", "custom"].includes(body.partnerStatus) ? body.partnerStatus : "unknown";
  let partnerCustomMessage = typeof body.partnerCustomMessage === "string" ? body.partnerCustomMessage.slice(0, 120) : "";
  let hasPartner = true;
  if (authRequired && signedIn) {
    const couple = await coupleForUser(signedIn.id);
    hasPartner = Boolean(couple?.has_partner);
    if (body.scope === "shared" && !hasPartner) { send(response, 409, { error: "Connect your partner to use shared chat. You can use private chat on your own." }); return; }
    const partner = hasPartner ? await database.query(
      `SELECT COALESCE(p.nickname, u.name) AS name, s.status, s.custom_message FROM couple_members cm
         JOIN "user" u ON u.id = cm.user_id
         LEFT JOIN closer_profiles p ON p.user_id = u.id
         LEFT JOIN couple_statuses s ON s.couple_id = cm.couple_id AND s.user_id = cm.user_id
           AND (s.expires_at IS NULL OR s.expires_at > now())
        WHERE cm.couple_id = $1 AND cm.user_id <> $2 LIMIT 1`, [couple.id, signedIn.id],
    ) : { rows: [] };
    partnerName = partner.rows[0]?.name || "your partner";
    partnerStatus = partner.rows[0]?.status || "unknown";
    partnerCustomMessage = partner.rows[0]?.custom_message || "";
    const sharedMemoryResult = hasPartner ? await database.query(
      `SELECT body FROM couple_memories
        WHERE couple_id = $1 AND kind = 'shared_note'
        ORDER BY created_at DESC LIMIT 20`, [couple.id],
    ) : { rows: [] };
    sharedMemories.splice(0, sharedMemories.length, ...sharedMemoryResult.rows.map((row) => row.body));
  }
  if (signedIn && !allowRequest(`ai:${signedIn.id}`, 12, 60_000)) {
    send(response, 429, { error: "Let’s take a short pause before sending another Closr message." });
    return;
  }
  try {
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        max_output_tokens: 400,
        instructions: instructionsFor({ scope: body.scope, partnerName, partnerStatus, partnerCustomMessage, sharedMemories, hasPartner }),
        input: messages.map(({ role, content }) => ({ role, content })),
        store: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error(`OpenAI API returned HTTP ${apiResponse.status}.`);
      send(response, 502, { error: "Closr couldn’t get a reply right now. Check the server's API setup and try again." });
      return;
    }
    const reply = Array.isArray(result.output)
      ? result.output.flatMap((item) => Array.isArray(item.content) ? item.content : []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n").trim()
      : "";
    if (!reply) { send(response, 502, { error: "Closr didn’t receive a text reply. Please try again." }); return; }
    send(response, 200, { reply });
  } catch {
    send(response, 502, { error: "Could not reach the AI service. Check your connection and try again." });
  }
}

async function handleTranscription(request, response, signedIn = null) {
  if (!process.env.OPENAI_API_KEY) {
    send(response, 503, { error: "Voice transcription isn’t available yet. You can type or choose your status instead." });
    return;
  }
  const allowedTypes = new Map([
    ["audio/webm", "webm"],
    ["audio/mp4", "mp4"],
    ["audio/wav", "wav"],
    ["audio/mpeg", "mp3"],
  ]);
  const requestedType = (request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const extension = allowedTypes.get(requestedType);
  if (!extension) { send(response, 415, { error: "This browser’s audio format isn’t supported. Try the status choices instead." }); return; }
  if (signedIn && !allowRequest(`voice:${signedIn.id}`, 8, 60_000)) {
    send(response, 429, { error: "Wait a moment before recording another voice command." });
    return;
  }
  let audio;
  try { audio = await readBytes(request, 20 * 1024 * 1024); } catch (error) { send(response, 413, { error: error.message }); return; }
  if (!audio.length) { send(response, 400, { error: "No audio was recorded. Try again." }); return; }
  const form = new FormData();
  form.append("file", new Blob([audio], { type: requestedType }), `closer-status.${extension}`);
  form.append("model", "gpt-transcribe");
  form.append("prompt", "A short spoken availability status in English or Hindi, such as open to a chat, taking quiet, or away for a bit.");
  try {
    const apiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    const result = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error(`OpenAI transcription returned HTTP ${apiResponse.status}.`);
      send(response, 502, { error: "Couldn’t transcribe that recording. Try again or choose a status." });
      return;
    }
    send(response, 200, { transcript: typeof result.text === "string" ? result.text : "" });
  } catch {
    send(response, 502, { error: "Couldn’t reach the transcription service. Try again or choose a status." });
  }
}

const recordingsApi = createRecordingsApi({ database, send, readJson, signedInUser, coupleForUser, allowRequest, signedMediaUrl, mediaBucket });
const journalApi = createJournalApi({ database, send, readJson, signedInUser, coupleForUser, allowRequest, signedMediaUrl, mediaBucket });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${host}:${port}`).pathname;
  // Cloud Run reserves some public paths ending in z; use these probe URLs
  // through both the ingress and the direct container health checks.
  if (request.method === "GET" && pathname === "/api/health") return send(response, 200, { ok: true });
  if (request.method === "GET" && pathname === "/api/ready") {
    try {
      if (database) {
        await database.query("SELECT 1");
        if (authRequired) {
          const schema = await database.query(`SELECT to_regclass('public."user"') AS auth_user, to_regclass('public.couples') AS couples, to_regclass('public.couple_memories') AS couple_memories, to_regclass('public.private_journal_entries') AS private_journal_entries, to_regclass('public.memory_media_assets') AS memory_media_assets, to_regclass('public.closer_profiles') AS closer_profiles, to_regclass('public.journal_pages') AS journal_pages, to_regclass('public.journal_recordings') AS journal_recordings`);
          if (!schema.rows[0]?.auth_user || !schema.rows[0]?.couples || !schema.rows[0]?.couple_memories || !schema.rows[0]?.private_journal_entries || !schema.rows[0]?.memory_media_assets || !schema.rows[0]?.closer_profiles || !schema.rows[0]?.journal_pages || !schema.rows[0]?.journal_recordings) throw new Error("Database migrations are missing.");
        }
      }
      if (process.env.NODE_ENV === "production" && (!auth || !database || !authRequired)) throw new Error("Production services are not configured.");
      return send(response, 200, { ready: true, authRequired });
    } catch {
      return send(response, 503, { ready: false });
    }
  }
  if (!applyApiCors(request, response)) return send(response, 403, { error: "This app origin is not allowed." });
  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    response.writeHead(204, { "Cache-Control": "no-store" });
    return response.end();
  }
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    if (!auth) return send(response, 503, { error: "Google sign-in is not configured. Set the authentication environment variables first." });
    return toNodeHandler(auth)(request, response);
  }
  let apiUser = null;
  try {
    if (await handleAccountApi(request, response, pathname)) return;
    if (await recordingsApi.handleApi(request, response, pathname)) return;
    if (await journalApi.handleApi(request, response, pathname)) return;
    if (await handleCoupleApi(request, response, pathname)) return;
    if (authRequired && ["/api/chat", "/api/transcribe"].includes(pathname)) {
      apiUser = await signedInUser(request, response);
      if (!apiUser) return;
      if (!await coupleForUser(apiUser.id)) return send(response, 409, { error: "Pair your account before using Closr." });
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    if (!response.headersSent) send(response, 500, { error: "Something went wrong. Please try again." });
    return;
  }
  if (request.method === "POST" && pathname === "/api/chat") return handleChat(request, response, apiUser);
  if (request.method === "POST" && pathname === "/api/transcribe") return handleTranscription(request, response, apiUser);
  if (request.method !== "GET") return send(response, 405, { error: "Method not allowed." });

  const files = { "/": "index.html", "/tracker.html": "tracker.html", "/tracker.css": "tracker.css", "/tracker.js": "tracker.js", "/index.html": "index.html", "/login.html": "login.html", "/auth.js": "auth.js", "/native-auth.js": "native-auth.js", "/runtime-config.js": "runtime-config.js", "/status.html": "status.html", "/memories.html": "memories.html", "/chat.html": "chat.html", "/partner-chat.html": "partner-chat.html", "/styles.css": "styles.css", "/app.js": "app.js" };
  files["/open-source.html"] = "open-source.html";
  for (const file of ["demo.html", "demo-chat.html", "demo-memories.html", "demo-my-journal.html", "demo-closr.html", "demo.css", "install.html", "offline.html", "manifest.webmanifest", "sw.js", "pwa.js", "pwa-icon-192.png", "pwa-icon-512.png", "apple-touch-icon.png", "our-journal.html", "journal.js", "journal.css", "moment-journal.js", "moment-journal.css"]) files[`/${file}`] = file;
  files["/open-source/social-login-source.tgz"] = "open-source/social-login-source.tgz";
  const file = files[pathname];
  if (!file) return send(response, 404, { error: "Not found." });
  try {
    const content = await readFile(resolve(root, file));
    send(response, 200, content, mimeTypes[extname(file)] || "application/octet-stream");
  } catch {
    send(response, 500, { error: "Could not load the app files." });
  }
});

server.requestTimeout = 180_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => console.log(`Closr is listening on ${host}:${port}`));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing server.`);
  const forcedExit = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    clearTimeout(forcedExit);
    try { await database?.end(); process.exit(0); }
    catch (error) { console.error("Database pool shutdown failed:", error.message); process.exit(1); }
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
