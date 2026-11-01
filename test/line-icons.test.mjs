import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const LEGACY_GLYPHS = /[✦⌁◇◒◎◈▤⌘⚑ⓘ↪♢◐✓＋⚙☀●▱▰◫◌◆▣▥≡◷⑂]|📄|📁|💬/u;

async function registryIcons() {
  const registry = await source("app-registry.ts");
  const icons = new Map();
  for (const match of registry.matchAll(/\{ id: "([a-z-]+)".*?icon: '(<svg[^']*)'/g)) icons.set(match[1], match[2]);
  const system = registry.slice(registry.indexOf("export const SYSTEM_ICONS"));
  for (const match of system.slice(0, system.indexOf("\n}")).matchAll(/^\s+"([a-z-]+)": '(<svg[^']*)',$/gm)) {
    assert.ok(!icons.has(match[1]), "system icon id must not shadow an App id: " + match[1]);
    icons.set(match[1], match[2]);
  }
  return icons;
}

function inlineIcons(code) {
  const start = code.indexOf("const ICONS: Record<string, string> = {");
  assert.ok(start >= 0, "module inlines its icon subset");
  const body = code.slice(start, code.indexOf("\n};", start));
  return new Map([...body.matchAll(/^\s+"([a-z-]+)": '(<svg[^']*)',$/gm)].map(match => [match[1], match[2]]));
}

test("one line-icon set: every icon is a unique 24px outline SVG", async () => {
  const icons = await registryIcons();
  assert.ok(icons.size >= 40);
  const seen = new Map();
  for (const [id, svg] of icons) {
    assert.match(svg, /^<svg viewBox="0 0 24 24" aria-hidden="true">/, id);
    assert.ok(!/fill=|stroke-width=|style=/.test(svg), id + " takes stroke/fill from CSS");
    assert.ok(!seen.has(svg), `${id} duplicates ${seen.get(svg)}`);
    seen.set(svg, id);
  }
});

test("standalone modules inline exact copies of the registry icons", async () => {
  const icons = await registryIcons();
  for (const file of ["settings.ts", "unified-workspace-nav.ts", "advanced.ts"]) {
    const code = await source(file);
    assert.ok(!/from "\.\/app-registry"/.test(code), file + " stays importable on its own");
    const copies = inlineIcons(code);
    assert.ok(copies.size > 0, file);
    for (const [id, svg] of copies) assert.equal(svg, icons.get(id), `${file}: ${id} must match app-registry.ts`);
  }
});

test("Settings rows, ☰ menu and file list use line icons instead of symbol glyphs", async () => {
  const [settings, nav, advanced, shell] = await Promise.all([
    source("settings.ts"), source("unified-workspace-nav.ts"), source("advanced.ts"), source("app-shell.ts")
  ]);
  const settingsIcons = inlineIcons(settings);
  const rows = [...settings.matchAll(/row\("([^"]+)", "([^"]+)"/g)];
  assert.ok(rows.length > 30);
  for (const [, icon, label] of rows) {
    assert.ok(/^\d+$/.test(icon) || settingsIcons.has(icon), `${label} uses a known icon (${icon})`);
  }
  // No orphaned copies: every inlined icon is drawn by a row or referenced as ICONS.<id>.
  const usedIcons = new Set(rows.map(([, icon]) => icon));
  for (const match of settings.matchAll(/ICONS\.([a-z]+)/g)) usedIcons.add(match[1]);
  for (const id of settingsIcons.keys()) assert.ok(usedIcons.has(id), `settings.ts inlines unused icon ${id}`);
  // External destinations use the shared line icon, not a one-off SVG.
  assert.match(settings, /devmoter-settings-chevron external" aria-hidden="true">\$\{ICONS\.external\}/);
  assert.ok(!/<svg viewBox="0 0 16 16"/.test(settings), "no one-off 16px SVG outside the line-icon set");
  // Rows for different destinations never share one icon (same concept → same icon is fine).
  const conceptByIcon = new Map();
  for (const [, icon, label] of rows) {
    if (/^\d+$/.test(icon)) continue;
    const concept = label.replace(/設定|の状態|を見る/g, "").replace(/s$/, "").replace("Terminal", "ターミナル").replace("Safety", "セーフティスキャン").replace("セーフティスキャン", "safety");
    if (conceptByIcon.has(icon)) assert.equal(conceptByIcon.get(icon), concept, `${icon} reused for ${label}`);
    else conceptByIcon.set(icon, concept);
  }
  const markup = code => code.replace(/const ICONS[\s\S]*?\n};/, "");
  for (const [name, code] of [["settings", settings], ["nav", nav]]) {
    const rendered = markup(code).match(/row\([^)]*\)|<span aria-hidden="true">[^<]*<\/span>|aria-label="設定を開く">[^<]*</g) || [];
    for (const part of rendered) assert.ok(!LEGACY_GLYPHS.test(part), `${name}: ${part}`);
  }
  for (const command of ["tasks", "chat", "review", "tools"]) {
    assert.match(nav, new RegExp(`data-workspace-action="${command}"[^>]*><span aria-hidden="true">\\$\\{ICONS\\.`));
  }
  for (const command of ["theme", "context", "checkpoints", "extensions"]) {
    assert.match(nav, new RegExp(`data-workspace-command="${command}"><span aria-hidden="true">\\$\\{ICONS\\.`));
  }
  assert.match(nav, /data-workspace-settings><span aria-hidden="true">\$\{ICONS\.settings\}/);
  assert.match(nav, /dm-task-first-menu-row"><span aria-hidden="true">\$\{ICONS\.language\}/);
  assert.ok(!/📁|📄/.test(advanced), "cloud browser file list has no emoji");
  assert.match(advanced, /ICONS\.projects : ICONS\.file/);
  assert.ok(!shell.includes("⚙"), "legacy settings entry uses the line icon");
  assert.match(shell, /SYSTEM_ICONS\.settings/);
});

test("icons draw in the body color with a 1.5 stroke", async () => {
  const [settingsCss, navCss] = await Promise.all([source("settings.css"), source("unified-workspace-nav.css")]);
  assert.match(settingsCss, /\.devmoter-settings-icon \{[^}]*color: currentColor;/);
  assert.ok(!/\.devmoter-settings-icon \{[^}]*#f2f2f3/.test(settingsCss), "icon no longer white on a light card");
  assert.match(settingsCss, /\.devmoter-settings-icon > svg[\s\S]*?stroke-width: 1\.5;/);
  assert.match(settingsCss, /\.devmoter-settings-step \{[^}]*border: 1px solid currentColor;/);
  assert.match(navCss, /:is\(\.dm-task-first-menu button, \.dm-task-first-menu-row\) > span > svg \{[^}]*stroke-width: 1\.5;/);
  assert.match(navCss, /\.dm-task-first-menu button > span \{[^}]*color: var\(--dw-text\);/);
});
