import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/build-if-needed.sh", import.meta.url));

test("unchanged restart skips build; source edit and missing output force rebuild", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules"));
  await mkdir(join(root, "bin"));
  await cp(script, join(root, "scripts", "build-if-needed.sh"));
  await writeFile(join(root, "src", "main.ts"), "export const value = 1;\n");
  await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
  const npm = join(root, "bin", "npm");
  await writeFile(npm, `#!/bin/sh
set -eu
printf 'build\\n' >> "$BUILD_LOG"
if [ "${BUILD_FAIL:-0}" = 1 ]; then exit 1; fi
mkdir -p dist
printf 'fixture' > dist/index.html
printf '{}' > dist/build.json
`);
  await chmod(npm, 0o755);
  const log = join(root, "builds.log");
  const env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH, BUILD_LOG: log };
  const run = () => execFileSync("bash", [join(root, "scripts", "build-if-needed.sh")], { cwd: root, env, encoding: "utf8" });
  assert.match(run(), /Build inputs changed/);
  assert.equal(await readFile(log, "utf8"), "build\n");
  assert.match(run(), /skipping build/);
  assert.equal(await readFile(log, "utf8"), "build\n");
  await writeFile(join(root, "src", "main.ts"), "export const value = 2;\n");
  assert.match(run(), /Build inputs changed/);
  assert.equal(await readFile(log, "utf8"), "build\nbuild\n");
  await rm(join(root, "dist", "index.html"));
  assert.match(run(), /Build inputs changed/);
  assert.equal(await readFile(log, "utf8"), "build\nbuild\nbuild\n");
});

test("a failed build cannot be mistaken for a valid fingerprint", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-build-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules"));
  await mkdir(join(root, "bin"));
  await cp(script, join(root, "scripts", "build-if-needed.sh"));
  await writeFile(join(root, "src", "app.ts"), "before");
  const npm = join(root, "bin", "npm");
  await writeFile(npm, "#!/bin/sh\nexit 3\n");
  await chmod(npm, 0o755);
  const env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH };
  assert.throws(() => execFileSync("bash", [join(root, "scripts", "build-if-needed.sh")], {
    cwd: root, env, stdio: "pipe"
  }));
  await assert.rejects(readFile(join(root, "dist", ".devmoter-source-fingerprint")));
});
