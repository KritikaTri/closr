import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mobileEnvironment, root } from "./mobile-config.mjs";

const env = await mobileEnvironment();
const requested = process.argv[2];
if (requested && !["android", "ios"].includes(requested)) throw new Error("Usage: npm run mobile:doctor -- [android|ios]");
const platforms = requested ? [requested] : ["android", "ios"];
let blocked = false;
async function exists(file) { try { await access(file); return true; } catch { return false; } }
function report(ok, text) {
  console.log(`${ok ? "OK" : "MISSING"}  ${text}`);
  if (!ok) blocked = true;
}
const api = new URL(env.CLOSER_API_BASE_URL);
report(api.protocol === "https:" && api.origin === env.CLOSER_API_BASE_URL, "HTTPS backend origin (public configuration)");
report(Boolean(env.GOOGLE_CLIENT_ID), "Google web OAuth client ID (public configuration)");

if (platforms.includes("android")) {
  console.log("\nAndroid");
  const java = spawnSync(env.JAVA_HOME ? join(env.JAVA_HOME, "bin/java") : "java", ["-version"], { encoding: "utf8", env });
  const javaVersion = `${java.stderr || ""}\n${java.stdout || ""}`.match(/version "(\d+)/)?.[1];
  report(java.status === 0 && Number(javaVersion) >= 21, "JDK 21 or newer for the Capacitor Android project");
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk"), join(homedir(), "Android/Sdk")].filter(Boolean);
  let sdk;
  for (const candidate of candidates) if (await exists(candidate)) { sdk = candidate; break; }
  report(Boolean(sdk), "Android SDK installation");
  report(Boolean(sdk && await exists(join(sdk, "platforms/android-36/android.jar"))), "Android API 36 SDK platform");
  report(Boolean(sdk && await exists(join(sdk, "build-tools/36.0.0/aapt2"))), "Android build tools 36.0.0");
  report(Boolean(sdk && await exists(join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"))), "Android platform tools (adb)");
  console.log("MANUAL   Register package com.closer.couples + the build certificate SHA-1 in Google Auth Platform before native Google sign-in.");
}

if (platforms.includes("ios")) {
  console.log("\niPhone");
  const xcode = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
  const xcodeVersion = xcode.stdout?.match(/Xcode (\d+)/)?.[1];
  report(process.platform === "darwin" && xcode.status === 0 && Number(xcodeVersion) >= 26, "Full Xcode 26 or newer, selected as the active developer directory");
  report(Boolean(env.GOOGLE_IOS_CLIENT_ID), "Google iOS OAuth client for bundle com.closer.couples");
  const project = await readFile(resolve(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  report(/DEVELOPMENT_TEAM\s*=\s*"?[A-Z0-9]{10}/.test(project), "Personal Apple developer team selected in the Xcode app target");
  console.log("MANUAL   TestFlight distribution needs Apple Developer Program enrollment and a signed archive.");
  console.log(`APPLE    ${env.APPLE_CLIENT_ID ? "Client ID set; verify server credentials and Apple capability before release." : "Not configured. Google-only beta preparation is allowed; the planned iOS store release requires Apple sign-in."}`);
}

console.log("\nThis reads local tools/configuration. It does not compile, run app tests, validate OAuth clients, or contact the backend.");
process.exitCode = blocked ? 1 : 0;
