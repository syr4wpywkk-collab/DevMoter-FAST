import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../src/api-chat-surface.css", import.meta.url), "utf8");

test("API Chat composer uses line icons, not font glyphs that render as tofu", () => {
  const foot = source.match(/<div class="api-composer-foot">([\s\S]*?)<\/form>/);
  assert.ok(foot, "composer foot markup exists");
  assert.ok(!/[＋↑]/u.test(foot[1]), "no symbol glyphs in the composer foot");
  assert.match(foot[1], /id="apiAttachImage"[^>]*title="\$\{escapeHtml\(t\("apiChat\.attachImageAria"\)\)\}"><svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.match(foot[1], /id="apiSend"[^>]*title="\$\{escapeHtml\(t\("common\.send"\)\)\}">\$\{API_SEND_ICON\}<\/button>/);
  assert.match(css, /\.api-app \.api-composer-foot button svg \{ width: 22px; height: 22px; \}/, "existing icon sizing applies");
});

test("send button restores its icon after a response finishes", () => {
  assert.match(source, /if \(sending\) send\.textContent = "…";\n\s*else send\.innerHTML = API_SEND_ICON;/);
  assert.match(source, /const API_SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"\/><\/svg>';/);
});
