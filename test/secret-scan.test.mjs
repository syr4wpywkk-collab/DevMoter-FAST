import test from "node:test";
import assert from "node:assert/strict";
import { findSecrets, isBinary, isSensitivePath } from "../scripts/secret-scan.mjs";

// Fixtures are assembled at runtime so this file never contains a literal
// credential that the repository scan itself would flag.
const chars = (alphabet, length, offset = 0) =>
  Array.from({ length }, (_, i) => alphabet[(i * 7 + offset) % alphabet.length]).join("");
const alnum = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ234567";

const samples = {
  "private key": ["-----BEGIN ", "ENCRYPTED PRIVATE KEY-----"].join(""),
  "GitHub token": "gh" + "p_" + chars(alnum, 36),
  "GitHub fine-grained token": "github" + "_pat_" + chars(alnum, 22) + "_" + chars(alnum, 59, 3),
  "OpenAI-style key": "sk-" + "ant-" + chars(alnum, 40),
  "AWS access key": "AS" + "IA" + chars(upper, 16),
  "Slack token": "xo" + "xb-" + chars(alnum, 24),
  "Slack app token": "xa" + "pp-1-" + chars(alnum, 24),
  "Slack webhook": "https://hooks.slack.com/services/" + "T" + chars(upper, 8) + "/B" + chars(upper, 8) + "/" + chars(alnum, 24),
  "Google API key": "AI" + "za" + chars(alnum, 35),
  "npm token": "np" + "m_" + chars(alnum, 36),
  "Stripe secret key": "sk" + "_live_" + chars(alnum, 24),
  "GitLab token": "gl" + "pat-" + chars(alnum, 20)
};

test("each supported credential format is detected", () => {
  for (const [name, value] of Object.entries(samples)) {
    assert.deepEqual(findSecrets(`config = "${value}";`), [name], name);
  }
});

test("a placeholder earlier in a file does not hide a real key later", () => {
  const placeholder = "AK" + "IA" + "EXAMPLE" + chars(upper, 9);
  const real = "AK" + "IA" + chars(upper, 16, 5);
  assert.deepEqual(findSecrets(placeholder), []);
  assert.deepEqual(findSecrets(`${placeholder}\n${real}`), ["AWS access key"]);
});

test("ordinary identifiers are not flagged", () => {
  assert.deepEqual(findSecrets("const task = 'sk-short'; const ghp = 'gh' + 'p_'; skeleton-loading-state"), []);
});

test("credential files are flagged by name, env templates are allowed", () => {
  for (const path of [".env", "ios/.env.production", ".netrc", "AuthKey_ABC123.p8", "release.keystore",
    "upload.jks", "ios/Dev.mobileprovision", "certs/server.pem", "deploy.ppk"]) {
    assert.ok(isSensitivePath(path), path);
  }
  for (const path of [".env.example", "docs/.env.template", "src/env.ts", "keys.md", "ios/DevMoter/DevMoterApp.swift"]) {
    assert.ok(!isSensitivePath(path), path);
  }
});

test("binary files are skipped, text files with any extension are scanned", () => {
  assert.ok(isBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])));
  assert.ok(!isBinary(Buffer.from("let token = \"" + samples["npm token"] + "\"\n")));
});
