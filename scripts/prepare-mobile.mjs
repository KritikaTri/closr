import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mobileEnvironment, root } from "./mobile-config.mjs";

const [platform, mode = process.env.CLOSER_RELEASE === "true" ? "release" : "beta", ...extra] = process.argv.slice(2);
if (!["android", "ios"].includes(platform) || !["beta", "release"].includes(mode) || extra.length) {
  throw new Error("Usage: node scripts/prepare-mobile.mjs android|ios [beta|release]");
}
const env = {
  ...await mobileEnvironment(),
  CLOSER_BUILD_TARGET: platform,
  CLOSER_MOBILE_BETA: mode === "beta" ? "true" : "false",
  CLOSER_RELEASE: mode === "release" ? "true" : "false",
};
const receiptDirectory = resolve(root, ".closer-mobile");
await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
const receiptPath = resolve(receiptDirectory, `${platform}-preparation.json`);
const receipt = { platform, mode, prepared: false, signedBinaryBuilt: false, apiOrigin: env.CLOSER_API_BASE_URL, startedAt: new Date().toISOString() };
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

function run(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run("scripts/build-web.mjs");
run("node_modules/@capacitor/cli/bin/capacitor", ["sync", platform]);
run("scripts/generate-notices.mjs", ["--sync-native"]);
await writeFile(receiptPath, `${JSON.stringify({ ...receipt, prepared: true, completedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
console.log(`${platform} ${mode} assets and native project are prepared for ${env.CLOSER_API_BASE_URL}.`);
console.log("This prepares the project; it does not compile, sign, install, or publish an app.");
