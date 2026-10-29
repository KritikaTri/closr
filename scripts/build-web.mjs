import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import plist from "plist";
import { auditBranding } from "./audit-branding.mjs";
import { generateNotices } from "./generate-notices.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "www");
const appFiles = ["index.html", "demo.html", "demo-chat.html", "demo-memories.html", "demo-my-journal.html", "demo-closr.html", "demo.css", "install.html", "offline.html", "manifest.webmanifest", "sw.js", "pwa.js", "pwa-icon-192.png", "pwa-icon-512.png", "apple-touch-icon.png", "login.html", "auth.js", "status.html", "memories.html", "our-journal.html", "journal.js", "journal.css", "moment-journal.js", "moment-journal.css", "chat.html", "partner-chat.html", "tracker.html", "styles.css", "app.js", "tracker.css", "tracker.js", "open-source.html"];

const apiBase = process.env.CLOSER_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const googleWebClientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
const googleIosClientId = process.env.GOOGLE_IOS_CLIENT_ID?.trim() || "";
const appleServiceId = process.env.APPLE_CLIENT_ID?.trim() || "";
const target = process.env.CLOSER_BUILD_TARGET || "native";
if (!["web", "native", "android", "ios"].includes(target)) throw new Error("CLOSER_BUILD_TARGET must be web, android, ios, or native.");
const release = process.env.CLOSER_RELEASE === "true";
const mobileBuild = target !== "web" && (release || process.env.CLOSER_MOBILE_BETA === "true");
const includesIos = ["ios", "native"].includes(target);
if (apiBase) {
  const origin = new URL(apiBase);
  if (origin.origin !== apiBase || origin.username || origin.password || !["http:", "https:"].includes(origin.protocol)) {
    throw new Error("CLOSER_API_BASE_URL must be an HTTP(S) origin with no path, credentials, query, or fragment.");
  }
}
if (mobileBuild && !apiBase.startsWith("https://")) {
  throw new Error("Set CLOSER_API_BASE_URL to the deployed HTTPS API origin before preparing a phone build.");
}
const googleClientPattern = /^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/;
if (mobileBuild && !googleClientPattern.test(googleWebClientId)) {
  throw new Error("Set GOOGLE_CLIENT_ID to the Google web client ID before preparing a phone build.");
}
if (mobileBuild && includesIos && !googleClientPattern.test(googleIosClientId)) {
  throw new Error("Set GOOGLE_IOS_CLIENT_ID to an iOS OAuth client for com.closer.couples. Android builds do not need this value.");
}
if (release && includesIos && !appleServiceId) {
  throw new Error("Set APPLE_CLIENT_ID to your Apple Sign-In Service ID before building an iOS release.");
}

await generateNotices();
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(appFiles.map(async (file) => {
  if (target === "web" && file.endsWith(".html")) {
    const html = await readFile(resolve(root, file), "utf8");
    const metadata = '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Closr"><script src="/pwa.js" defer></script>';
    await writeFile(resolve(output, file), html.replace("</head>", `${metadata}</head>`));
  } else await cp(resolve(root, file), resolve(output, file));
}));
await cp(resolve(root, "open-source"), resolve(output, "open-source"), { recursive: true });
await build({
  entryPoints: [resolve(root, "native-auth-entry.js")],
  outfile: resolve(output, "native-auth.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  minify: mobileBuild || release,
});
const configSource = [
  `window.CLOSER_API_BASE_URL = ${JSON.stringify(apiBase)};`,
  `window.CLOSER_GOOGLE_CONFIG = ${JSON.stringify({ webClientId: googleWebClientId, iOSClientId: googleIosClientId })};`,
  `window.CLOSER_APPLE_CONFIG = ${JSON.stringify({ serviceId: appleServiceId, redirectUrl: apiBase ? `${apiBase}/api/auth/callback/apple` : "" })};`,
  "",
].join("\n");
await writeFile(resolve(output, "runtime-config.js"), configSource);
if (target !== "web" && includesIos && googleIosClientId) {
  const infoPlistPath = resolve(root, "ios/App/App/Info.plist");
  if (!googleClientPattern.test(googleIosClientId)) throw new Error("GOOGLE_IOS_CLIENT_ID is not a Google OAuth client ID.");
  const info = plist.parse(await readFile(infoPlistPath, "utf8"));
  const reversedClientId = googleIosClientId.split(".").reverse().join(".");
  const urlTypes = (info.CFBundleURLTypes || []).filter((entry) => entry.CFBundleURLName !== "closer.google-sign-in" &&
    !entry.CFBundleURLSchemes?.some((scheme) => scheme.startsWith("com.googleusercontent.apps.")));
  info.CFBundleURLTypes = [...urlTypes, { CFBundleURLName: "closer.google-sign-in", CFBundleURLSchemes: [reversedClientId] }];
  await writeFile(infoPlistPath, `${plist.build(info)}\n`);
}
await auditBranding({ includeNative: target !== "web" });
console.log(`Copied ${appFiles.length} web app files into www/.`);
