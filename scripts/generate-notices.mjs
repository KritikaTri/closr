import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const embeddedPackages = ["@capacitor/core", "@capacitor/android", "@capacitor/ios", "@capacitor/share", "@capacitor/clipboard", "@capgo/capacitor-social-login"];
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const ignoredSourceDirectories = new Set([".git", "build", ".gradle", "node_modules"]);

async function sourceFingerprint(directory) {
  const hash = createHash("sha256").update("closer-source-archive-v1");
  async function walk(path, relative = "") {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredSourceDirectories.has(entry.name)) continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(resolve(path, entry.name), name);
      else if (entry.isFile()) hash.update(name).update("\0").update(await readFile(resolve(path, entry.name))).update("\0");
    }
  }
  await walk(directory);
  return hash.digest("hex");
}

export async function generateNotices({ syncNative = false } = {}) {
  const entries = [];
  for (const name of embeddedPackages) {
    const directory = resolve(projectRoot, "node_modules", name);
    const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
    const licenseFiles = (await readdir(directory)).filter((file) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(file)).sort();
    if (!licenseFiles.length) throw new Error(`Missing license notice for ${name}; release packaging stopped.`);
    const notices = await Promise.all(licenseFiles.map(async (file) => `${file}\n${await readFile(resolve(directory, file), "utf8")}`));
    entries.push({ name, version: manifest.version, license: manifest.license, notices: notices.join("\n\n") });
  }
  const cordova = await readFile(resolve(projectRoot, "node_modules/@capacitor/core/cordova.js"), "utf8");
  const cordovaHeader = cordova.slice(cordova.indexOf("/*"), cordova.indexOf("*/") + 2);
  entries.push({ name: "Apache Cordova components included with Capacitor", version: "", license: "Apache-2.0", notices: `${cordovaHeader}\n\n${await readFile(resolve(projectRoot, "node_modules/@google-cloud/storage/LICENSE"), "utf8")}` });

  // The native provider configuration can modify files inside the plugin.
  // Bundle the installed source, including those changes, rather than only
  // pointing recipients at an upstream version which might differ.
  const sourceDirectory = resolve(projectRoot, "open-source");
  await mkdir(sourceDirectory, { recursive: true });
  const installedPlugin = resolve(projectRoot, "node_modules/@capgo/capacitor-social-login");
  const fingerprint = await sourceFingerprint(installedPlugin);
  const archivePath = resolve(sourceDirectory, "social-login-source.tgz");
  const manifestPath = resolve(sourceDirectory, "source-manifest.json");
  const previous = await readFile(manifestPath, "utf8").then(JSON.parse).catch(() => null);
  const archiveHash = await readFile(archivePath).then((bytes) => createHash("sha256").update(bytes).digest("hex")).catch(() => null);
  if (previous?.sourceFingerprint !== fingerprint || previous?.archiveSha256 !== archiveHash) {
  const temporary = await mkdtemp(resolve(tmpdir(), "closer-source-"));
  try {
    const packageSource = resolve(temporary, "capacitor-social-login");
    await cp(installedPlugin, packageSource, { recursive: true, filter: (source) => !source.slice(installedPlugin.length).split("/").some((part) => ignoredSourceDirectories.has(part)) });
    async function extractTypeScript(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) await extractTypeScript(file);
        else if (entry.name.endsWith(".js.map")) {
          const map = JSON.parse(await readFile(file, "utf8"));
          for (let index = 0; index < (map.sources || []).length; index += 1) {
            const source = map.sources[index].replaceAll("\\", "/");
            const marker = source.lastIndexOf("src/");
            if (marker < 0 || typeof map.sourcesContent?.[index] !== "string") continue;
            const target = resolve(packageSource, source.slice(marker));
            if (!target.startsWith(`${packageSource}/src/`)) throw new Error("Unexpected source map path.");
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, map.sourcesContent[index]);
          }
        }
      }
    }
    await extractTypeScript(resolve(packageSource, "dist"));
    const archive = spawnSync("tar", ["-czf", archivePath, "-C", temporary, "capacitor-social-login"], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
    if (archive.status !== 0) throw new Error(archive.stderr || "Could not package the MPL source archive.");
    await writeFile(manifestPath, `${JSON.stringify({ package: "@capgo/capacitor-social-login", version: entries.find((entry) => entry.name === "@capgo/capacitor-social-login").version, sourceFingerprint: fingerprint, archiveSha256: createHash("sha256").update(await readFile(archivePath)).digest("hex") }, null, 2)}\n`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  const cards = entries.map((entry) => `<details><summary>${escapeHtml(entry.name)} ${escapeHtml(entry.version)} · ${escapeHtml(entry.license)}</summary><pre>${escapeHtml(entry.notices)}</pre></details>`).join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Open-source notices · Closr</title><link rel="stylesheet" href="styles.css"><style>body{display:block;background:#f6f6f1;padding:24px}main{max-width:840px;margin:auto;padding:clamp(20px,5vw,44px);background:#fff;border-radius:24px}h1{font-size:28px;margin:20px 0}p{line-height:1.7}a{color:#526746}details{border-top:1px solid #e6e8df;padding:18px 0}summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6}section{margin:28px 0}</style></head>
<body><main><a href="index.html">← Back to Closr</a><h1>Open-source notices</h1><p>Closr uses open-source components. The notices and licenses below apply to those components.</p><section><h2>Source availability</h2><p>The social login component is licensed under the Mozilla Public License 2.0. <a href="open-source/social-login-source.tgz" download>Download its corresponding source code</a>, including the installed native configuration and the TypeScript sources supplied in its source maps. The archive includes the license and original notices.</p></section>${cards}<section><h2>Fonts</h2><p>The web interface loads DM Sans and Manrope from Google Fonts. Their source and SIL Open Font License notices are available from the <a href="https://github.com/google/fonts/tree/main/ofl/dmsans" rel="noreferrer">DM Sans project</a> and <a href="https://github.com/google/fonts/tree/main/ofl/manrope" rel="noreferrer">Manrope project</a>.</p></section></main></body></html>
`;
  // Keep upstream source archives intact; normalize trailing whitespace only
  // in the displayed HTML notices.
  await writeFile(resolve(projectRoot, "open-source.html"), html.replace(/[ \t]+$/gm, ""));
  if (syncNative) {
    for (const directory of ["www", "ios/App/App/public", "android/app/src/main/assets/public"]) {
      await mkdir(resolve(projectRoot, directory), { recursive: true });
      await cp(resolve(projectRoot, "open-source.html"), resolve(projectRoot, directory, "open-source.html"));
      await cp(sourceDirectory, resolve(projectRoot, directory, "open-source"), { recursive: true });
    }
  }
  console.log(`Generated license notices and corresponding source for ${entries.length} embedded components.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateNotices({ syncNative: process.argv.includes("--sync-native") });
