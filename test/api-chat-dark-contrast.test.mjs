import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function luminance(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map(c => c + c).join("") : value;
  const channels = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(?:var\(--[\w-]+,\s*)?(#[0-9a-f]{3,6})\b/gi)].map(m => [m[1], m[2]]));
}

function assertReadable(palette, label) {
  for (const fg of ["text", "muted"]) {
    for (const bg of ["bg", "surface"]) {
      const ratio = contrast(palette[fg], palette[bg]);
      assert.ok(ratio >= 4.5, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1`);
    }
  }
}

test("API Chat dark theme text and secondary text meet WCAG AA on its surfaces", async () => {
  const [base, surface, extras] = await Promise.all([
    read("src/styles/base.css"),
    read("src/api-chat-surface.css"),
    read("src/styles/chat-extras.css")
  ]);

  const root = tokens(base.match(/:root\s*\{[^}]*\}/)[0]);
  assertReadable({ text: root["text-primary"], muted: root["text-secondary"], bg: root["canvas-base"], surface: root["surface-panel"] }, "global dark tokens");

  const darkRule = surface.match(/html\[data-devmoter-theme="dark"\] \.api-app \{([^}]*)\}/);
  assert.ok(darkRule, "explicit API Chat dark theme rule exists");
  assert.match(darkRule[1], /--api-bg: var\(--canvas-base,/);
  assert.match(darkRule[1], /--api-text: var\(--text-primary,/);
  assert.match(darkRule[1], /--api-muted: var\(--text-secondary,/);
  const fallback = tokens(darkRule[1]);
  assertReadable({ text: fallback["api-text"], muted: fallback["api-muted"], bg: fallback["api-bg"], surface: fallback["api-surface"] }, "API Chat dark fallbacks");

  const systemDark = extras.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*\.api-app \{([^}]*)\}/);
  assert.ok(systemDark, "system dark-mode API Chat palette exists");
  const system = tokens(systemDark[1]);
  assertReadable({ text: system["api-text"], muted: system["api-muted"], bg: system["api-bg"], surface: system["api-surface"] }, "system dark palette");
});

test("API Chat header identity uses the contrast-checked text tokens in the dark theme", async () => {
  const surface = await read("src/api-chat-surface.css");
  assert.match(surface, /\.api-app \{[^}]*background: var\(--api-bg\);[^}]*color: var\(--api-text\);/);
  assert.match(surface, /\.api-app \.api-brand small \{[^}]*color: var\(--api-muted\)/);
});
