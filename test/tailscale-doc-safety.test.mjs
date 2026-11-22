import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const docs = ["README.md", "README.ja.md", "README.zh-CN.md", "fastinstall.MD"];
test("installation docs preserve existing Tailscale Serve/Funnel routes", async () => {
  for (const doc of docs) {
    const content = await readFile(new URL("../" + doc, import.meta.url), "utf8");
    assert.doesNotMatch(content, /tailscale\s+serve\s+reset\b/, doc + " must never recommend destructive resets");
    assert.match(content, /tailscale serve get-config --all/, doc + " must explain inspection first");
    assert.match(content, /tailscale serve status --json/, doc + " must verify the configured route");
  }
});
