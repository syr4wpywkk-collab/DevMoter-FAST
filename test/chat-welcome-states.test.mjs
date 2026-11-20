import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

const source = file => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

// #348: every chat screen opens on a localized welcome state instead of a blank transcript.
test("#348: Codex, OpenCode, API Chat and Qwen each render a welcome state", async () => {
  const [codex, opencode, api, qwen] = await Promise.all(["codex.ts", "opencode.ts", "api-chat.ts", "qwen-chat.ts"].map(source));
  assert.match(codex, /<div class="cx-welcome">[\s\S]*?t\("codex\.welcome\.title"\)[\s\S]*?t\("codex\.welcome\.subtitle"\)/);
  assert.match(opencode, /<div class="ocx-welcome">[\s\S]*?t\("opencode\.welcome\.title"\)[\s\S]*?t\("opencode\.welcome\.subtitle"\)/);
  for (const hint of ["plan", "build", "command"]) assert.match(opencode, new RegExp(`data-hint="${hint}"`), `OpenCode ${hint} hint`);
  // The API Chat welcome prompt is a mount option (DeepSeek reuses the
  // surface) that defaults to apiChat.welcomePrompt.
  assert.match(api, /<section id="apiWelcome" class="api-welcome">[\s\S]*?t\(welcomePromptKey\)/);
  assert.match(api, /const welcomePromptKey = options\.welcomePromptKey \|\| "apiChat\.welcomePrompt";/);
  assert.match(qwen, /<section class="qx-welcome" data-qwen-welcome>/);
});

test("#348: the welcome state gives way to the first message", async () => {
  const [codex, opencode, api] = await Promise.all(["codex.ts", "opencode.ts", "api-chat.ts"].map(source));
  assert.match(codex, /transcript\.querySelector\("\.cx-welcome"\)\?\.remove\(\)/);
  assert.ok((opencode.match(/transcript\.querySelector\("\.ocx-welcome"\)\?\.remove\(\)/g) || []).length >= 3, "OpenCode removes welcome for text, tool and reasoning parts");
  assert.match(api, /welcome\.classList\.toggle\("hidden", messages\.length > 0\)/);
});

test("#348: welcome strings exist in every locale", () => {
  const keys = ["codex.welcome.title", "codex.welcome.subtitle", "opencode.welcome.title", "opencode.welcome.subtitle", "opencode.welcome.hintPlan", "opencode.welcome.hintBuild", "opencode.welcome.hintCommand", "apiChat.welcomePrompt", "qwen.chat.welcomeDefault", "qwen.chat.welcomeProject"];
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
    for (const key of keys) assert.ok(dictionary[key], `${language} ${key}`);
  }
});
