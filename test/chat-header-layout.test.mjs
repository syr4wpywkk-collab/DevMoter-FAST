import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const header = (code, open) => code.slice(code.indexOf(open), code.indexOf("</header>", code.indexOf(open)));
const GLYPHS = /[＋⚙✦]/u;

test("chat headers share one slot order: history, identity, context control, new chat", async () => {
  const surfaces = {
    codex: ["codex.ts", '<header class="cx-topbar">', ["cxMenu", "cxTitleButton", "cxDetailsTop", "cxNewChatTop"]],
    opencode: ["opencode.ts", '<header class="ocx-topbar">', ["ocxMenu", "ocxSessionTitleButton", "ocxModelButton", "ocxNewSessionTop"]],
    api: ["api-chat.ts", '<header class="api-topbar">', ["apiMenu", "apiModelTopLabel", "apiSettingsTop", "apiNewChatTop"]]
  };
  for (const [surface, [file, open, ids]] of Object.entries(surfaces)) {
    const markup = header(await source(file), open);
    const positions = ids.map(id => markup.indexOf(`id="${id}"`));
    assert.ok(positions.every(position => position >= 0), `${surface} header has ${ids.join(", ")}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${surface} header keeps the shared slot order`);
    for (const match of markup.matchAll(/<button\b[^>]*>([^<]*)/g)) {
      assert.ok(!GLYPHS.test(match[1]), `${surface} header buttons use line icons, not glyphs: ${match[0]}`);
    }
  }
});

test("icon-only header actions are labelled and API Chat new chat reuses the sidebar action", async () => {
  const api = await source("api-chat.ts");
  assert.match(api, /id="apiNewChatTop"[^>]*aria-label="\$\{escapeHtml\(t\("apiChat\.newChatAria"\)\)\}"/);
  assert.match(api, /newChatTop\.addEventListener\("click", \(\) => newChat\.click\(\)\)/, "one new-chat path keeps upload and abort guards");
  const opencode = await source("opencode.ts");
  assert.match(opencode, /id="ocxNewSessionTop"[^>]*title="\$\{escapeHtml\(t\("opencode\.sidebar\.newSessionAria"\)\)\}"/);
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) assert.ok(dictionary["apiChat.newChatAria"], language);
});

test("header titles and subtitles truncate on one line at one type scale", async () => {
  const [codex, opencode, api] = await Promise.all([source("codex-chat.css"), source("opencode-chat.css"), source("api-chat-surface.css")]);
  assert.match(codex, /\.cx-title-button > small \{\n  max-width: 100%;\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;/);
  assert.match(opencode, /\.ocx-session-title small \{ max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; \}/);
  assert.match(api, /\.api-brand strong \{ overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 1rem; font-weight: 600; \}/);
  assert.match(codex, /\.cx-title-button > span \{\n  font-size: 1rem;\n  font-weight: 600;/);
  assert.match(opencode, /\.ocx-session-title strong \{ font-size: 1rem; font-weight: 600; \}/);
});
