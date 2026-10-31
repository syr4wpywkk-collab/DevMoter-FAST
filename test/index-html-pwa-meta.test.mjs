import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const { document } = new JSDOM(html).window;
const meta = name => document.querySelector(`meta[name="${name}"]`)?.getAttribute("content");

test("index.html declares the standard mobile-web-app-capable meta (no deprecation warning)", () => {
  assert.equal(meta("mobile-web-app-capable"), "yes");
});

test("index.html keeps the iOS standalone settings", () => {
  assert.equal(meta("apple-mobile-web-app-capable"), "yes");
  assert.equal(meta("apple-mobile-web-app-status-bar-style"), "black-translucent");
  assert.equal(document.querySelector('link[rel="manifest"]')?.getAttribute("href"), "/manifest.webmanifest");
});
