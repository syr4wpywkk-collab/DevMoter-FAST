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
  assert.deepEqual([...SUPPORTED_LANGUAGES], ["ja", "en", "zh-Hans", "zh-Hant"]);
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

  // Traditional Chinese (zh-Hant) uses Taiwan terminology rather than mechanical conversion alone.
  assert.notEqual(DICTIONARIES["zh-Hant"]["common.default"], DICTIONARIES["zh-Hans"]["common.default"]);
  assert.equal(DICTIONARIES["zh-Hant"]["common.default"], "預設");
  assert.equal(DICTIONARIES["zh-Hant"]["common.details"], "詳細資料");
  assert.equal(DICTIONARIES["zh-Hant"]["settings.root.files"], "檔案與預覽");
  assert.equal(DICTIONARIES["zh-Hant"]["settings.root.terminal"], "終端機");
  assert.equal(DICTIONARIES["zh-Hant"]["sessionTitle.new"], "新工作階段");
});

test("login screen standalone I18N table has identical keys and placeholders across en, ja, zh-Hans, zh-Hant", async () => {
  const loginSource = await readFile(new URL("../public/login.js", import.meta.url), "utf8");
  const match = loginSource.match(/const I18N = (\{[\s\S]*?\n    \});/);
  assert.ok(match, "public/login.js defines I18N");
  const table = vm.runInNewContext(`(${match[1]})`, Object.create(null));
  const enKeys = Object.keys(table.en).sort();
  assert.ok(enKeys.length > 30);

  for (const lang of ["en", "ja", "zh-Hans", "zh-Hant"]) {
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
  assert.equal(translate("zh-Hans", "common.save"), DICTIONARIES["zh-Hans"]["common.save"]);
  assert.equal(translate("zh-Hant", "common.save"), DICTIONARIES["zh-Hant"]["common.save"]);
  assert.equal(translate("zh", "common.save"), DICTIONARIES["zh-Hans"]["common.save"]);
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

test("normalizeLanguage and detectBrowserLanguage map Hans/Hant and ja/en variants with en fallback", () => {
  assert.equal(normalizeLanguage("ja"), "ja");
  assert.equal(normalizeLanguage("ja-JP"), "ja");
  assert.equal(normalizeLanguage("EN_us"), "en");
  assert.equal(normalizeLanguage("zh"), "zh-Hans");
  assert.equal(normalizeLanguage("zh-CN"), "zh-Hans");
  assert.equal(normalizeLanguage("zh-SG"), "zh-Hans");
  assert.equal(normalizeLanguage("zh-Hans"), "zh-Hans");
  assert.equal(normalizeLanguage("zh-Hans-SG"), "zh-Hans");
  assert.equal(normalizeLanguage("zh-Hans-TW"), "zh-Hans");
  assert.equal(normalizeLanguage("zh-TW"), "zh-Hant");
  assert.equal(normalizeLanguage("zh_TW"), "zh-Hant");
  assert.equal(normalizeLanguage("zh-HK"), "zh-Hant");
  assert.equal(normalizeLanguage("zh-MO"), "zh-Hant");
  assert.equal(normalizeLanguage("zh-Hant"), "zh-Hant");
  assert.equal(normalizeLanguage("zh-Hant-TW"), "zh-Hant");
  assert.equal(normalizeLanguage("zh-Hant-HK"), "zh-Hant");
  assert.equal(normalizeLanguage("zh-CN-x-tw"), "zh-Hans");
  assert.equal(normalizeLanguage("fr"), null);
  assert.equal(normalizeLanguage(""), null);
  assert.equal(normalizeLanguage(null), null);

  assert.equal(detectBrowserLanguage({ languages: ["ja-JP", "en-US"] }), "ja");
  assert.equal(detectBrowserLanguage({ languages: ["fr-FR", "zh-Hans"] }), "zh-Hans");
  assert.equal(detectBrowserLanguage({ languages: ["zh"] }), "zh-Hans");
  assert.equal(detectBrowserLanguage({ languages: ["zh-CN"] }), "zh-Hans");
  assert.equal(detectBrowserLanguage({ languages: ["zh-SG"] }), "zh-Hans");
  assert.equal(detectBrowserLanguage({ languages: ["zh-TW"] }), "zh-Hant");
  assert.equal(detectBrowserLanguage({ languages: ["zh-HK"] }), "zh-Hant");
  assert.equal(detectBrowserLanguage({ languages: ["zh-MO"] }), "zh-Hant");
  assert.equal(detectBrowserLanguage({ languages: ["fr-FR", "zh-Hant-TW"] }), "zh-Hant");
  assert.equal(detectBrowserLanguage({ languages: ["es-ES"], language: "en-GB" }), "en");
  assert.equal(detectBrowserLanguage({ languages: ["fr-FR", "de-DE"], language: "fr-FR" }), "en");
  assert.equal(detectBrowserLanguage(null), "en");
});

test("first-run default uses browser language when supported; legacy stored zh migrates to zh-Hans", () => {
  withDomEnv({ navLanguages: ["ja-JP"] }, () => {
    assert.equal(resolveLanguage(), "ja");
    assert.equal(getLanguage(), "ja");
  });
  withDomEnv({ navLanguages: ["zh-CN"] }, () => {
    assert.equal(getLanguage(), "zh-Hans");
  });
  withDomEnv({ navLanguages: ["zh-TW"] }, () => {
    assert.equal(getLanguage(), "zh-Hant");
  });
  withDomEnv({ navLanguages: ["es-ES"] }, () => {
    assert.equal(getLanguage(), "en");
  });
  withDomEnv({ navLanguages: ["ja-JP"], storedLanguage: "zh-CN" }, () => {
    assert.equal(getLanguage(), "zh-Hans");
  });
  withDomEnv({ navLanguages: ["ja-JP"], storedLanguage: "zh-TW" }, () => {
    assert.equal(getLanguage(), "zh-Hant");
  });
  withDomEnv({ navLanguages: ["zh-TW"], storedLanguage: "zh" }, ({ localStorage, document }) => {
    assert.equal(getLanguage(), "zh-Hans");
    assert.equal(localStorage.getItem(STORAGE_KEY), "zh-Hans");

    // Reset to legacy value and verify startI18n migrates and updates document/selects cleanly.
    localStorage.setItem(STORAGE_KEY, "zh");
    const migrated = startI18n({ reload: false });
    assert.equal(migrated, "zh-Hans");
    assert.equal(localStorage.getItem(STORAGE_KEY), "zh-Hans");
    assert.equal(document.documentElement.lang, "zh-Hans");
    assert.equal(document.querySelector("[data-language-select]").value, "zh-Hans");
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
      assert.deepEqual([...select.options].map(option => option.value), ["ja", "en", "zh-Hans", "zh-Hant"]);
      assert.deepEqual(
        [...select.options].map(option => option.textContent),
        ["日本語", "English", "简体中文", "繁體中文"]
      );
      assert.equal(select.value, "en");

      const next = setLanguage("ja", { reload: false });
      assert.equal(next, "ja");
      assert.equal(localStorage.getItem(STORAGE_KEY), "ja");
      assert.equal(document.documentElement.lang, "ja");
      assert.equal(select.value, "ja");
      assert.deepEqual(events, ["ja"]);
      assert.equal(getReloadCount(), 0);

      select.value = "zh-Hans";
      select.dispatchEvent(new document.defaultView.Event("change"));
      assert.equal(localStorage.getItem(STORAGE_KEY), "zh-Hans");
      assert.equal(document.documentElement.lang, "zh-Hans");
      assert.deepEqual(events, ["ja", "zh-Hans"]);
      assert.equal(getReloadCount(), 0);

      select.value = "zh-Hant";
      select.dispatchEvent(new document.defaultView.Event("change"));
      assert.equal(localStorage.getItem(STORAGE_KEY), "zh-Hant");
      assert.equal(document.documentElement.lang, "zh-Hant");
      assert.deepEqual(events, ["ja", "zh-Hans", "zh-Hant"]);
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

test("login screen runtime handles zh-Hans/zh-Hant detection, options, and legacy zh migration", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/login.html", import.meta.url), "utf8"),
    readFile(new URL("../public/login.js", import.meta.url), "utf8")
  ]);

  const bootLogin = async ({ navLanguages = ["en-US"], storedLanguage = undefined } = {}) => {
    const dom = new JSDOM(html, { url: "https://devmoter.test/login.html", runScripts: "outside-only" });
    try {
      Object.defineProperty(dom.window.navigator, "languages", {
        value: navLanguages,
        configurable: true
      });
      Object.defineProperty(dom.window.navigator, "language", {
        value: navLanguages[0] || "en-US",
        configurable: true
      });
      if (storedLanguage !== undefined) {
        dom.window.localStorage.setItem(STORAGE_KEY, storedLanguage);
      }
      dom.window.fetch = async () => ({
        ok: true,
        async json() {
          return { authenticated: false, providers: {} };
        }
      });
      dom.window.eval(script);
      await new Promise(resolve => setTimeout(resolve, 0));
      const select = dom.window.document.querySelector("#languageSelect");
      return {
        lang: dom.window.document.documentElement.lang,
        stored: dom.window.localStorage.getItem(STORAGE_KEY),
        options: [...select.options].map(opt => [opt.value, opt.textContent]),
        selected: select.value
      };
    } finally {
      dom.window.close();
    }
  };

  const tw = await bootLogin({ navLanguages: ["zh-TW"] });
  assert.equal(tw.lang, "zh-Hant");
  assert.equal(tw.selected, "zh-Hant");
  assert.deepEqual(tw.options, [
    ["ja", "日本語"],
    ["en", "English"],
    ["zh-Hans", "简体中文"],
    ["zh-Hant", "繁體中文"]
  ]);

  const hk = await bootLogin({ navLanguages: ["zh-HK"] });
  assert.equal(hk.lang, "zh-Hant");

  const sg = await bootLogin({ navLanguages: ["zh-SG"] });
  assert.equal(sg.lang, "zh-Hans");

  const bare = await bootLogin({ navLanguages: ["zh"] });
  assert.equal(bare.lang, "zh-Hans");

  const migrated = await bootLogin({ navLanguages: ["zh-TW"], storedLanguage: "zh" });
  assert.equal(migrated.lang, "zh-Hans");
  assert.equal(migrated.stored, "zh-Hans");
  assert.equal(migrated.selected, "zh-Hans");
});

test("locale-sensitive helpers, app catalog helper, and server message mappings behave consistently", () => {
  assert.equal(localeTag("ja"), "ja-JP");
  assert.equal(localeTag("en"), "en-US");
  assert.equal(localeTag("zh-Hans"), "zh-CN");
  assert.equal(localeTag("zh-Hant"), "zh-TW");
  assert.equal(localeTag("zh"), "zh-CN");
  assert.equal(speechRecognitionLanguage("zh-Hans"), "zh-CN");
  assert.equal(speechRecognitionLanguage("zh-Hant"), "zh-TW");

  const sampleTime = Date.UTC(2026, 4, 10, 12, 34);
  assert.ok(formatDateTime(sampleTime, { month: "numeric", day: "numeric" }, "ja").length > 0);
  assert.ok(formatTime(sampleTime, undefined, "zh-Hans").length > 0);
  assert.ok(formatTime(sampleTime, undefined, "zh-Hant").length > 0);
  assert.equal(formatNumber(1234, undefined, "en"), "1,234");
  assert.ok(formatRelativeTime(sampleTime - 120_000, sampleTime, "ja").length > 0);

  assert.equal(tApp("mission-control", "title", "en"), DICTIONARIES.en["apps.missionControl.title"]);
  assert.equal(tApp("mission-control", "title", "ja"), DICTIONARIES.ja["apps.missionControl.title"]);
  assert.equal(tApp("mission-control", "title", "zh-Hans"), DICTIONARIES["zh-Hans"]["apps.missionControl.title"]);
  assert.equal(tApp("mission-control", "title", "zh-Hant"), DICTIONARIES["zh-Hant"]["apps.missionControl.title"]);
  assert.equal(tApp("unknown-app", "title", "en"), "");

  assert.equal(
    translateServerMessage("Authentication required", "ja"),
    DICTIONARIES.ja["errors.server.authRequired"]
  );
  assert.equal(
    translateServerMessage("Authentication required", "zh-Hans"),
    DICTIONARIES["zh-Hans"]["errors.server.authRequired"]
  );
  assert.equal(
    translateServerMessage("Authentication required", "zh-Hant"),
    DICTIONARIES["zh-Hant"]["errors.server.authRequired"]
  );
  assert.equal(
    translateServerMessage("Qwen Code のモデル一覧を読めませんでした", "en"),
    DICTIONARIES.en["errors.server.qwenModelsFailed"]
  );
  assert.equal(translateServerMessage("Arbitrary dynamic message", "ja"), "Arbitrary dynamic message");
});
