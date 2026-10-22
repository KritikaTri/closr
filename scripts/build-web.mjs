import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "www");
const appFiles = ["index.html", "login.html", "auth.js", "status.html", "memories.html", "chat.html", "partner-chat.html", "tracker.html", "styles.css", "app.js", "tracker.css", "tracker.js"];

const apiBase = process.env.CLOSER_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const googleWebClientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
const googleIosClientId = process.env.GOOGLE_IOS_CLIENT_ID?.trim() || "";
if (process.env.CLOSER_RELEASE === "true" && !apiBase.startsWith("https://")) {
  throw new Error("Set CLOSER_API_BASE_URL to the deployed HTTPS API origin before building a mobile release.");
}
if (process.env.CLOSER_RELEASE === "true" && (!googleWebClientId || !googleIosClientId)) {
  throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_IOS_CLIENT_ID before building a mobile release with native Google sign-in.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(appFiles.map((file) => cp(resolve(root, file), resolve(output, file))));
await build({
  entryPoints: [resolve(root, "native-auth-entry.js")],
  outfile: resolve(output, "native-auth.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  minify: process.env.CLOSER_RELEASE === "true",
});
const configSource = [
  `window.CLOSER_API_BASE_URL = ${JSON.stringify(apiBase)};`,
  `window.CLOSER_GOOGLE_CONFIG = ${JSON.stringify({ webClientId: googleWebClientId, iOSClientId: googleIosClientId })};`,
  "",
].join("\n");
await writeFile(resolve(output, "runtime-config.js"), configSource);
if (process.env.CLOSER_RELEASE === "true") {
  const infoPlistPath = resolve(root, "ios/App/App/Info.plist");
  const infoPlist = await readFile(infoPlistPath, "utf8");
  if (!infoPlist.includes("<key>CFBundleURLTypes</key>")) {
    const reversedClientId = googleIosClientId.split(".").reverse().join(".");
    const urlTypes = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${reversedClientId}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
    await writeFile(infoPlistPath, infoPlist.replace("</dict>\n</plist>", `${urlTypes}</dict>\n</plist>`));
  }
}
console.log(`Copied ${appFiles.length} web app files into www/.`);
