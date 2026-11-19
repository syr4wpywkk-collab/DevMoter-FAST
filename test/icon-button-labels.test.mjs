import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

// #354: a button whose visible text is only a symbol (↑, /, ×, an SVG…) needs an
// accessible name, or screen readers announce nothing useful.
const BUTTON = /<button\b([^>]*)>([^<]{0,8})<\/button>/g;

export function unlabelledIconButtons(source) {
  return [...source.matchAll(BUTTON)]
    .filter(([, attrs, text]) => {
      const visible = text.trim();
      const iconOnly = !/[\p{L}\p{N}]/u.test(visible) && !visible.includes("${");
      return iconOnly && !/\baria-label(ledby)?=|\btitle=/.test(attrs);
    })
    .map(([markup]) => markup);
}

test("detector flags only symbol-only buttons without a name", () => {
  assert.deepEqual(unlabelledIconButtons('<button type="button">/</button><button aria-label="Send">↑</button><button>Save</button>'), ['<button type="button">/</button>']);
});

test("#354: every symbol-only button in src/*.ts templates has an accessible name", async () => {
  const dir = new URL("../src/", import.meta.url);
  const files = (await readdir(dir)).filter(file => file.endsWith(".ts"));
  const missing = [];
  for (const file of files) {
    for (const markup of unlabelledIconButtons(await readFile(new URL(file, dir), "utf8"))) missing.push(`${file}: ${markup}`);
  }
  assert.deepEqual(missing, []);
});
