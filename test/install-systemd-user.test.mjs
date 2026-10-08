import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const installer = join(root, "scripts/install-systemd-user.sh");
const templatePath = join(root, "systemd/devmoter-fast.service.in");

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-service-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, "bin");
  const log = join(home, "systemctl.log");
  const config = join(home, "config");
  const unitDir = join(config, "systemd", "user");
  const unitPath = join(unitDir, "devmoter-fast.service");
  await mkdir(bin);
  await writeFile(join(bin, "systemctl"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SYSTEMCTL_LOG"\nexit 0\n');
  await chmod(join(bin, "systemctl"), 0o700);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: config,
    PATH: bin + ":" + process.env.PATH,
    SYSTEMCTL_LOG: log
  };
  return { env, log, config, unitDir, unitPath };
}

function invoke(env, ...args) {
  return spawnSync("bash", [installer, ...args], {
    env, encoding: "utf8", timeout: 5000
  });
}

async function auditLog(log) {
  try { return await readFile(log, "utf8"); } catch { return ""; }
}

test("service check is read-only and a missing unit fails without creating directories", async t => {
  const f = await fixture(t);
  const result = invoke(f.env, "--check");
  assert.equal(result.status, 1);
  await assert.rejects(lstat(f.unitDir));
  assert.equal(await auditLog(f.log), "");
});

test("first install is atomic and private; repeated install is idempotent", async t => {
  const f = await fixture(t);
  const first = invoke(f.env);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /DevMoter service: installed/);
  const content = await readFile(f.unitPath, "utf8");
  assert.match(content, /Managed by DevMoter FAST Installer v2/);
  assert.ok(content.includes(root + "/scripts/systemd-entrypoint.sh"));
  assert.equal((await lstat(f.unitPath)).mode & 0o777, 0o600);
  assert.equal(await auditLog(f.log), "--user daemon-reload\n");

  const second = invoke(f.env);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /DevMoter service: unchanged/);
  assert.equal(await readFile(f.unitPath, "utf8"), content);
  assert.equal(await auditLog(f.log), "--user daemon-reload\n");

  const check = invoke(f.env, "--check");
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /service: installed/);
});

test("explicit start requests enable service and checks only systemd active state", async t => {
  const f = await fixture(t);
  const result = invoke(f.env, "--start");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verify authenticated \/api\/health/);
  assert.equal(await auditLog(f.log),
    "--user daemon-reload\n--user enable --now devmoter-fast.service\n--user is-active --quiet devmoter-fast.service\n");
});

test("custom service content is preserved and no daemon reload is attempted", async t => {
  const f = await fixture(t);
  await mkdir(f.unitDir, { recursive: true });
  const customized = "[Service]\nExecStart=/bin/true\n";
  await writeFile(f.unitPath, customized);
  const result = invoke(f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to overwrite/i);
  assert.equal(await readFile(f.unitPath, "utf8"), customized);
  assert.equal(await auditLog(f.log), "");
});

test("legacy generated service is safely adopted without changing its execution", async t => {
  const f = await fixture(t);
  await mkdir(f.unitDir, { recursive: true });
  const template = await readFile(templatePath, "utf8");
  await writeFile(f.unitPath, template.replaceAll("@WORKDIR@", root));
  const result = invoke(f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /service: upgraded/);
  assert.match(await readFile(f.unitPath, "utf8"), /^# Managed by DevMoter FAST/);
});

test("unit symlinks are refused and their target is preserved", async t => {
  const f = await fixture(t);
  await mkdir(f.unitDir, { recursive: true });
  const target = join(f.env.HOME, "unrelated-unit");
  await writeFile(target, "do not replace\n");
  await symlink(target, f.unitPath);
  const result = invoke(f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlinked/i);
  assert.equal(await readFile(target, "utf8"), "do not replace\n");
  assert.equal(await auditLog(f.log), "");
});

test("symlinked systemd directory and unexpected arguments are rejected", async t => {
  const f = await fixture(t);
  const extra = invoke(f.env, "--start", "unexpected");
  assert.equal(extra.status, 2);
  await mkdir(f.config);
  await symlink(f.env.HOME, join(f.config, "systemd"));
  const result = invoke(f.env);
  assert.notEqual(result.status, 0);
  assert.equal(await auditLog(f.log), "");
});
