import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["src", "server", "test", "scripts", "public"];
const textExtensions = new Set([".ts", ".mts", ".mjs", ".js", ".css", ".html", ".json", ".webmanifest", ".svg"]);
const syntaxExtensions = new Set([".mjs", ".js"]);
const files = ["server.mjs"];

async function walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path);
  }
}

for (const root of roots) await walk(root);

const failures = [];
for (const file of [...new Set(files)].sort()) {
  const content = await readFile(file, "utf8");
  if (/^(<{7}|={7}|>{7})/m.test(content)) {
    failures.push(`${file}: unresolved merge-conflict marker`);
  }
  if (content.includes("\0")) {
    failures.push(`${file}: contains NUL byte`);
  }

  if (syntaxExtensions.has(extname(file))) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      failures.push(`${file}: JavaScript syntax check failed\n${error.stderr?.toString() || error.message}`);
    }
  }
}

try {
  const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (icons.length === 0) failures.push("public/manifest.webmanifest: icons must not be empty");
  for (const icon of icons) {
    const src = String(icon?.src || "");
    if (!src.startsWith("/") || src.includes("..")) {
      failures.push(`public/manifest.webmanifest: invalid icon src ${src || "(empty)"}`);
      continue;
    }
    try {
      await access(join("public", src.slice(1)));
    } catch {
      failures.push(`public/manifest.webmanifest: missing icon asset ${src}`);
    }
  }
} catch (error) {
  failures.push(`public/manifest.webmanifest: invalid manifest (${error.message})`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`lint: checked ${files.length} source files`);
