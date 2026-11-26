import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verificationExecutionPlan } from "../server/verification-sandbox.mjs";
import { createDevWorkflowService } from "../server/dev-workflows.mjs";

const available = () => ({ status: 0, stdout: "bubblewrap 0.10.0" });
const unavailable = () => ({ status: 127, stdout: "" });

async function fixture(t, sandboxEnv, sandboxSpawn, verificationRun) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-verification-isolation-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = join(home, "project");
  await mkdir(project);
  const service = createDevWorkflowService({
    homeDir: home,
    configDir: join(home, "config"),
    codex: {},
    projectResolver: async id => ({ id, path: project }),
    sandboxEnv,
    sandboxSpawn,
    verificationRun,
  });
  await service.updateSettings({
    verification: { commands: [{ name: "fixture", command: "node", args: ["fixture.mjs"] }] },
  });
  return { service, project };
}

test("required verification uses isolated namespaces and a minimal environment", async t => {
  const env = { DEVMOTER_SANDBOX: "required", FIXTURE_SECRET: "synthetic", HOME: "/private-home" };
  const calls = [];
  const { service, project } = await fixture(t, env, available, async (...args) => {
    calls.push(args);
    return { stdout: "ok", stderr: "" };
  });
  const result = await service.runVerification("p1");
  assert.equal(result.ok, true);
  assert.equal(result.commands[0].executionMode, "bubblewrap");
  assert.equal(calls.length, 1);
  const [binary, args, options] = calls[0];
  assert.equal(binary, "bwrap");
  const cwd = await realpath(project);
  assert.equal(options.cwd, cwd);
  assert.deepEqual(options.env, {
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp", LANG: "C.UTF-8",
  });
  const wrapper = args.slice(0, args.indexOf("--"));
  for (const flag of ["--unshare-net", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--die-with-parent"]) {
    assert.ok(wrapper.includes(flag), flag);
  }
  assert.equal(wrapper.includes("/run"), false);
  assert.equal(wrapper.includes("/etc"), false);
  assert.ok(wrapper.join(" ").includes("--bind " + cwd + " " + cwd));
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["node", "fixture.mjs"]);
});

test("required verification never falls back to host execution", async t => {
  for (const env of [
    { DEVMOTER_SANDBOX: "required" },
    { DEVMOTER_VERIFICATION_SANDBOX: "required" },
    { DEVMOTER_VERIFICATION_SANDBOX: "required", DEVMOTER_SANDBOX: "off" },
    { DEVMOTER_VERIFICATION_SANDBOX: "invalid" },
  ]) {
    let calls = 0;
    const { service } = await fixture(t, env, unavailable, async () => {
      calls++;
      return { stdout: "", stderr: "" };
    });
    const result = await service.runVerification("p1");
    assert.equal(result.ok, false);
    assert.equal(result.commands[0].executionMode, "blocked");
    assert.equal(calls, 0);
  }
});

test("a failed sandbox launch is not retried outside isolation", async t => {
  const calls = [];
  const { service } = await fixture(t, { DEVMOTER_VERIFICATION_SANDBOX: "required" }, available, async binary => {
    calls.push(binary);
    throw new Error("synthetic wrapper startup failure");
  });
  const result = await service.runVerification("p1");
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["bwrap"]);
});

test("existing non-required configuration remains host mode and reports it", async t => {
  const calls = [];
  const { service, project } = await fixture(t, {}, unavailable, async (...args) => {
    calls.push(args);
    return { stdout: "ok", stderr: "" };
  });
  const result = await service.runVerification("p1");
  assert.equal(result.ok, true);
  assert.equal(result.commands[0].executionMode, "host");
  assert.equal(calls[0][0], "node");
  assert.equal(calls[0][2].cwd, project);
});

test("isolated verification rejects broad roots and relative project paths", async () => {
  const base = { command: "node", args: [], env: { DEVMOTER_SANDBOX: "required" }, spawn: available };
  await assert.rejects(verificationExecutionPlan({ ...base, projectPath: "/" }), /dedicated project/);
  await assert.rejects(verificationExecutionPlan({ ...base, projectPath: "relative" }), /absolute project/);
});
