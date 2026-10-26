import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unwantedBrand = /\bcisco\b|@cisco\.com|\bwebex\b|\bmeraki\b|\bthousandeyes\b|\bappdynamics\b/i;
const textExtensions = new Set([".html", ".js", ".css", ".json", ".xml", ".plist", ".swift", ".java", ".gradle", ".pbxproj", ".xcconfig", ".entitlements", ".svg"]);

function pngText(bytes) {
  const parts = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) break;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") parts.push(data.toString("utf8"));
    if (type === "zTXt") {
      const end = data.indexOf(0);
      if (end >= 0) parts.push(data.subarray(0, end).toString("utf8"), inflateSync(data.subarray(end + 2)).toString("utf8"));
    }
    if (type === "iTXt") {
      const end = data.indexOf(0);
      const languageEnd = data.indexOf(0, end + 3);
      const translatedEnd = data.indexOf(0, languageEnd + 1);
      if (end >= 0 && languageEnd >= 0 && translatedEnd >= 0) {
        const content = data.subarray(translatedEnd + 1);
        parts.push(data.subarray(0, end).toString("utf8"), (data[end + 1] ? inflateSync(content) : content).toString("utf8"));
      }
    }
    offset += length + 12;
  }
  return parts.join("\n");
}

export async function auditBranding({ includeNative = true } = {}) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(resolve(projectRoot, path), { withFileTypes: true })) {
      if (["build", ".gradle", ".swiftpm", "Pods"].includes(entry.name)) continue;
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (textExtensions.has(extname(entry.name)) || extname(entry.name) === ".png") files.push(relative);
    }
  }
  for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
    if (entry.isFile() && textExtensions.has(extname(entry.name)) && entry.name !== "package-lock.json") files.push(entry.name);
  }
  const directories = includeNative
    ? ["assets", "android/app/src/main", "ios/App/App", "ios/App/App.xcodeproj", "www"]
    : ["www"];
  for (const directory of directories) {
    try { await walk(directory); }
    catch (error) { if (directory !== "www" || error.code !== "ENOENT") throw error; }
  }
  const failures = [];
  for (const file of files) {
    const bytes = await readFile(resolve(projectRoot, file));
    const text = extname(file) === ".png" ? pngText(bytes) : bytes.toString("utf8");
    if (unwantedBrand.test(text)) failures.push(file);
  }
  if (failures.length) throw new Error(`Unexpected company branding in app files: ${failures.join(", ")}`);
  console.log(`Branding audit passed for ${files.length} app files, including image metadata.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await auditBranding();
