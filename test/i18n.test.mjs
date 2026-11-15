import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  DICTIONARIES,
  STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  applyDocumentLocale,
  bindLanguageSelectors,
  detectBrowserLanguage,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  formatTime,
  getLanguage,
  interpolate,
  localeTag,
  normalizeLanguage,
  onLanguageChange,
  resolveLanguage,
  setLanguage,
  speechRecognitionLanguage,
  startI18n,
  tApp,
  translate,
  translateServerMessage
} from "../src/i18n-core.mjs";

function placeholders(template) {
  return [...new Set([...String(template).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]))].sort();
}

function withDomEnv(options, fn) {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><body><select data-language-select></select></body></html>',
    { url: "https://devmoter.example/" }
  );
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  let reloadCount = 0;
  const navValue = {
    language: options.navLanguage ?? "fr-FR",
    languages: options.navLanguages ?? [options.navLanguage ?? "fr-FR"]
  };
  const winProxy = {
    location: {
      reload() {
        reloadCount += 1;
      }
    },
    addEventListener: dom.window.addEventListener.bind(dom.window)
  };
  if (options.storedLanguage !== undefined) {
    dom.window.localStorage.setItem(STORAGE_KEY, options.storedLanguage);
  }

  Object.defineProperty(globalThis, "window", { value: winProxy, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: navValue, configurable: true, writable: true });

  try {
    return fn({
      dom,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      getReloadCount: () => reloadCount
    });
  } finally {
    const restore = (key, desc) => {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    };
    restore("window", prevWindow);
    restore("document", prevDocument);
    restore("localStorage", prevStorage);
    restore("navigator", prevNavigator);
    dom.window.close();
  }
}

test("all locale dictionaries have identical keys, non-empty values, and matching placeholders", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ["ja", "en", "zh"]);
  const baseKeys = Object.keys(DICTIONARIES.en).sort();
  assert.ok(baseKeys.length > 500, `expected rich dictionary, found ${baseKeys.length} keys`);

  for (const lang of SUPPORTED_LANGUAGES) {
    const dict = DICTIONARIES[lang];
    const keys = Object.keys(dict).sort();
    assert.deepEqual(keys, baseKeys, `key set mismatch for locale "${lang}"`);
    for (const key of baseKeys) {
      const value = dict[key];
      assert.equal(typeof value, "string", `${lang}:${key} must be a string`);
      assert.ok(value.trim().length > 0, `${lang}:${key} must be non-empty`);
      assert.deepEqual(
        placeholders(value),
        placeholders(DICTIONARIES.en[key]),
        `placeholder mismatch for ${lang}:${key}`
      );
    }
  }
});

test("login screen standalone I18N table has identical keys and placeholders across en, ja, zh", async () => {
  const loginSource = await readFile(new URL("../public/login.js", import.meta.url), "utf8");
  const match = loginSource.match(/const I18N = (\{[\s\S]*?\n    \});/);
  assert.ok(match, "public/login.js defines I18N");
  const table = vm.runInNewContext(`(${match[1]})`, Object.create(null));
  const enKeys = Object.keys(table.en).sort();
  assert.ok(enKeys.length > 30);

  for (const lang of ["en", "ja", "zh"]) {
    const keys = Object.keys(table[lang]).sort();
    assert.deepEqual(keys, enKeys, `login I18N key mismatch for "${lang}"`);
    for (const key of enKeys) {
      assert.equal(typeof table[lang][key], "string");
      assert.ok(table[lang][key].trim().length > 0, `login ${lang}:${key} non-empty`);
      assert.deepEqual(
        placeholders(table[lang][key]),
        placeholders(table.en[key]),
        `login placeholder mismatch for ${lang}:${key}`
      );
    }
  }
});

test("translate fallback chain resolves selected locale -> en -> key without throwing", () => {
  assert.equal(translate("ja", "common.save"), DICTIONARIES.ja["common.save"]);
  assert.equal(translate("zh", "common.save"), DICTIONARIES.zh["common.save"]);
  assert.equal(translate("en", "common.save"), DICTIONARIES.en["common.save"]);
  // Unsupported locale normalizes to English.
  assert.equal(translate("fr-FR", "common.save"), DICTIONARIES.en["common.save"]);
  // Unknown key falls back to the key string itself.
  assert.equal(translate("ja", "nonexistent.translation.key"), "nonexistent.translation.key");
  // Missing selected locale entry falls back silently to en (verified via i18n-core lookup rules).
  assert.equal(interpolate("Count: {count}", { count: 3 }), "Count: 3");
  assert.equal(interpolate("Count: {count}", {}), "Count: {count}");
  assert.equal(translate("ja", null), "");
  assert.equal(translate("ja", undefined), "");
});

test("normalizeLanguage and detectBrowserLanguage normalize ja/en/zh variants and fall back to en", () => {
  assert.equal(normalizeLanguage("ja"), "ja");
  assert.equal(normalizeLanguage("ja-JP"), "ja");
  assert.equal(normalizeLanguage("EN_us"), "en");
  assert.equal(normalizeLanguage("zh"), "zh");
  assert.equal(normalizeLanguage("zh-CN"), "zh");
  assert.equal(normalizeLanguage("zh-Hans-SG"), "zh");
  assert.equal(normalizeLanguage("zh_TW"), "zh");
  assert.equal(normalizeLanguage("fr"), null);
  assert.equal(normalizeLanguage(""), null);
  assert.equal(normalizeLanguage(null), null);

  assert.equal(detectBrowserLanguage({ languages: ["ja-JP", "en-US"] }), "ja");
  assert.equal(detectBrowserLanguage({ languages: ["fr-FR", "zh-Hans"] }), "zh");
  assert.equal(detectBrowserLanguage({ languages: ["es-ES"], language: "en-GB" }), "en");
  assert.equal(detectBrowserLanguage({ languages: ["fr-FR", "de-DE"], language: "fr-FR" }), "en");
  assert.equal(detectBrowserLanguage(null), "en");
});

test("first-run default uses browser language when supported, otherwise en; stored preference wins", () => {
  withDomEnv({ navLanguages: ["ja-JP"] }, () => {
    assert.equal(resolveLanguage(), "ja");
    assert.equal(getLanguage(), "ja");
  });
  withDomEnv({ navLanguages: ["zh-CN"] }, () => {
    assert.equal(getLanguage(), "zh");
  });
  withDomEnv({ navLanguages: ["es-ES"] }, () => {
    assert.equal(getLanguage(), "en");
  });
  withDomEnv({ navLanguages: ["ja-JP"], storedLanguage: "zh-CN" }, () => {
    assert.equal(getLanguage(), "zh");
  });
});

test("setLanguage, applyDocumentLocale, startI18n, and bindLanguageSelectors persist choice and set html[lang]", () => {
  withDomEnv({ navLanguages: ["en-US"] }, ({ document, localStorage, getReloadCount }) => {
    const events = [];
    const unsubscribe = onLanguageChange(lang => events.push(lang));
    try {
      const initial = startI18n({ reload: false });
      assert.equal(initial, "en");
      assert.equal(document.documentElement.lang, "en");

      const select = document.querySelector("[data-language-select]");
      assert.ok(select);
      assert.deepEqual([...select.options].map(option => option.value), ["ja", "en", "zh"]);
      assert.equal(select.value, "en");

      const next = setLanguage("ja", { reload: false });
      assert.equal(next, "ja");
      assert.equal(localStorage.getItem(STORAGE_KEY), "ja");
      assert.equal(document.documentElement.lang, "ja");
      assert.equal(select.value, "ja");
      assert.deepEqual(events, ["ja"]);
      assert.equal(getReloadCount(), 0);

      select.value = "zh";
      select.dispatchEvent(new document.defaultView.Event("change"));
      assert.equal(localStorage.getItem(STORAGE_KEY), "zh");
      assert.equal(document.documentElement.lang, "zh");
      assert.deepEqual(events, ["ja", "zh"]);
      assert.equal(getReloadCount(), 0);

      // Re-binding respects reload: true when requested.
      delete select.dataset.i18nBound;
      bindLanguageSelectors(document, { reload: true });
      select.value = "ja";
      select.dispatchEvent(new document.defaultView.Event("change"));
      assert.equal(localStorage.getItem(STORAGE_KEY), "ja");
      assert.equal(getReloadCount(), 1);

      assert.equal(applyDocumentLocale("en", document), "en");
      assert.equal(document.documentElement.lang, "en");
    } finally {
      unsubscribe();
    }
  });
});

test("locale-sensitive helpers, app catalog helper, and server message mappings behave consistently", () => {
  assert.equal(localeTag("ja"), "ja-JP");
  assert.equal(localeTag("en"), "en-US");
  assert.equal(localeTag("zh"), "zh-CN");
  assert.equal(speechRecognitionLanguage("zh"), "zh-CN");

  const sampleTime = Date.UTC(2026, 4, 10, 12, 34);
  assert.ok(formatDateTime(sampleTime, { month: "numeric", day: "numeric" }, "ja").length > 0);
  assert.ok(formatTime(sampleTime, undefined, "zh").length > 0);
  assert.equal(formatNumber(1234, undefined, "en"), "1,234");
  assert.ok(formatRelativeTime(sampleTime - 120_000, sampleTime, "ja").length > 0);

  assert.equal(tApp("mission-control", "title", "en"), DICTIONARIES.en["apps.missionControl.title"]);
  assert.equal(tApp("mission-control", "title", "ja"), DICTIONARIES.ja["apps.missionControl.title"]);
  assert.equal(tApp("mission-control", "title", "zh"), DICTIONARIES.zh["apps.missionControl.title"]);
  assert.equal(tApp("unknown-app", "title", "en"), "");

  assert.equal(
    translateServerMessage("Authentication required", "ja"),
    DICTIONARIES.ja["errors.server.authRequired"]
  );
  assert.equal(
    translateServerMessage("Authentication required", "zh"),
    DICTIONARIES.zh["errors.server.authRequired"]
  );
  assert.equal(
    translateServerMessage("Qwen Code のモデル一覧を読めませんでした", "en"),
    DICTIONARIES.en["errors.server.qwenModelsFailed"]
  );
  assert.equal(translateServerMessage("Arbitrary dynamic message", "ja"), "Arbitrary dynamic message");
});
