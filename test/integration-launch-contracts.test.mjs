import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  desktopTerminalCandidates,
  launchInTerminal
} from "../server/integrations.mjs";

test("desktop launch candidates keep CLI arguments separated from the shell", () => {
  const command = "/home/test/.local/bin/agy";
  const extraArgs = ["--model", "gemini-2.5-pro"];
  const candidates = desktopTerminalCandidates("linux", command, extraArgs);

  assert.ok(candidates.length >= 4);
  for (const candidate of candidates) {
    assert.ok(Array.isArray(candidate.args));
    assert.equal(candidate.args.includes(command), true);
    assert.equal(candidate.args.includes("--model"), true);
    assert.equal(candidate.args.includes("gemini-2.5-pro"), true);
    assert.equal(candidate.args.some(arg => /agy.*--model/.test(arg)), false);
  }
});

test("desktop launcher falls back across terminals and preserves cwd", async () => {
  const calls = [];
  const result = await launchInTerminal(
    "/home/test/.local/bin/agy",
    "/home/test/project",
    [],
    { PATH: "/usr/bin" },
    {
      platform: "linux",
      resolveExecutable: async name => name === "gnome-terminal" ? "/usr/bin/gnome-terminal" : null,
      spawnDetached: async (bin, args, cwd, env) => {
        calls.push({ bin, args, cwd, env });
      }
    }
  );

  assert.equal(result.terminal, "gnome-terminal");
  assert.deepEqual(calls, [{
    bin: "/usr/bin/gnome-terminal",
    args: ["--", "/home/test/.local/bin/agy"],
    cwd: "/home/test/project",
    env: { PATH: "/usr/bin" }
  }]);
});

test("desktop launcher reports unsupported platforms and missing terminals", async () => {
  await assert.rejects(
    () => launchInTerminal("/usr/bin/agy", "/tmp/project", [], {}, { platform: "darwin" }),
    /not implemented for darwin/
  );

  await assert.rejects(
    () => launchInTerminal(
      "/usr/bin/agy",
      "/tmp/project",
      [],
      {},
      {
        platform: "linux",
        resolveExecutable: async () => null,
        spawnDetached: async () => {
          throw new Error("must not spawn");
        }
      }
    ),
    /No supported desktop terminal/
  );
});

test("integration UI surfaces launch failures instead of silently swallowing them", async () => {
  const source = await readFile(new URL("../src/integrations.ts", import.meta.url), "utf8");
  assert.match(source, /showNotice\(error instanceof Error \? error\.message : String\(error\), "error"\)/);
});
