import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Office real HTTP: owner/origin gates, edits, provider adapter, download and restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "office-http-"));
  const password = "office-http-test-password-2026";
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
  let shared;
  let firstRequestedModel;
  const mock = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const payload = JSON.parse(data);
    firstRequestedModel = payload.model;
    shared = JSON.parse(payload.messages.at(-1).content);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                edits: [
                  {
                    blockId: shared.blocks[0].blockId,
                    text: "Actual provider adapter proposal",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  let secondRequestedModel;
  const mock2 = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const payload = JSON.parse(data);
    secondRequestedModel = payload.model;
    const body = JSON.parse(payload.messages.at(-1).content);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                edits: [
                  {
                    blockId: body.blocks[0].blockId,
                    text: "Second provider proposal",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  mock.listen(0, "127.0.0.1");
  mock2.listen(0, "127.0.0.1");
  await Promise.all([once(mock, "listening"), once(mock2, "listening")]);
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server.mjs"], {
      env: {
        ...process.env,
        HOME: home,
        POCKET_PORT: String(port),
        POCKET_HOST: "127.0.0.1",
        DEVMOTER_AUTH_PASSWORD: password,
        CODEX_BIN: "__office_test_unavailable__",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Office HTTP server startup timed out")),
        20000,
      );
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("DevMoter FAST:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Office HTTP server exited"));
      });
    });
  };
  t.after(async () => {
    if (child?.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await Promise.all([new Promise((r) => mock.close(r)), new Promise((r) => mock2.close(r))]);
    await rm(home, { recursive: true, force: true });
  });
  await start();
  const request = (path, method = "GET", body) =>
    fetch(origin + path, {
      method,
      headers: { authorization, origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await fetch(origin + "/api/office/documents")).status, 401);
  assert.equal(
    (
      await fetch(origin + "/api/office/documents", {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          origin: "https://evil.invalid",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  const missingId = "00000000-0000-0000-0000-000000000000";
  for (const [suffix, method, payload] of [
    ["", "GET"],
    ["", "DELETE"],
    ["/download", "GET"],
    ["", "PATCH", { revision: missingId, blocks: [] }],
    ["", "PATCH", { revision: missingId, ops: [] }],
    ["", "PATCH", { revision: missingId, cells: [] }],
    ["/rename", "POST", { name: "Missing.docx" }],
    ["/restore", "POST", { revision: missingId, target: missingId }],
    ["/pdf-op", "POST", { revision: missingId, op: { kind: "rotate", pages: [1], degrees: 90 } }],
  ]) {
    const path = `/api/office/documents/${missingId}${suffix}`;
    const response = await request(path, method, payload);
    assert.equal(response.status, 404, `${method} ${path}`);
    const body = await response.text();
    assert.doesNotMatch(body, /ENOENT/);
    assert.ok(!body.includes(home), "response must not expose the server home path");
    assert.deepEqual(JSON.parse(body), { error: "文書が見つかりません。" });
  }
  let response = await request("/api/office/documents", "POST", {
    blank: true,
    name: "Integration.docx",
  });
  assert.equal(response.status, 201);
  const doc = await response.json();
  const saved = await (
    await request(`/api/office/documents/${doc.id}`, "PATCH", {
      revision: doc.revision,
      blocks: [
        { id: doc.blocks.find((b) => b.editable).id, type: "paragraph", runs: [{ text: "Read this text" }] },
        { type: "heading", level: 2, runs: [{ text: "Second paragraph", bold: true }] },
      ],
    })
  ).json();
  assert.equal(saved.blocks.filter((b) => b.editable).length, 2);
  assert.equal(
    (
      await request(`/api/office/documents/${doc.id}`, "PATCH", {
        revision: doc.revision,
        blocks: [{ id: "b0", type: "paragraph", runs: [{ text: "stale" }] }],
      })
    ).status,
    409,
  );
  response = await request("/api/llm/providers", "POST", {
    id: "office-test",
    name: "Office mock",
    presetId: "custom",
    baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
    protocol: "openai-compatible",
    apiKey: "dummy-office-local-key",
    models: ["office-model", "office-model-alt"],
  });
  assert.equal(response.status, 200);
  response = await request("/api/llm/providers", "POST", {
    id: "office-test-2",
    name: "Office mock 2",
    presetId: "custom",
    baseUrl: `http://127.0.0.1:${mock2.address().port}/v1`,
    protocol: "openai-compatible",
    apiKey: "dummy-office-local-key-2",
    models: ["office-model-2a", "office-model-2b"],
  });
  assert.equal(response.status, 200);
  const contextRes = await (await request("/api/tools-ai/context")).json();
  assert.deepEqual(
    contextRes.providers.map((p) => ({ id: p.id, models: p.models })),
    [
      { id: "office-test", models: ["office-model", "office-model-alt"] },
      { id: "office-test-2", models: ["office-model-2a", "office-model-2b"] },
    ],
  );
  response = await request("/api/office/ai/runs", "POST", {
    documentId: doc.id,
    revision: saved.revision,
    goal: "Improve",
    providerId: "office-test",
    model: "office-model",
    share: true,
  });
  assert.equal(response.status, 202);
  let run = await response.json();
  for (let i = 0; i < 50 && run.status === "planning"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    run = await (await request(`/api/office/ai/runs/${run.id}`)).json();
  }
  assert.equal(run.status, "proposed", run.error);
  assert.equal(firstRequestedModel, "office-model");
  assert.equal(run.edits[0].text, "Actual provider adapter proposal");
  assert.equal(shared.blocks[0].text, "Read this text");
  response = await request("/api/office/ai/runs", "POST", {
    documentId: doc.id,
    revision: saved.revision,
    goal: "Switch provider and model",
    providerId: "office-test-2",
    model: "office-model-2b",
    share: true,
  });
  assert.equal(response.status, 202);
  let run2 = await response.json();
  for (let i = 0; i < 50 && run2.status === "planning"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    run2 = await (await request(`/api/office/ai/runs/${run2.id}`)).json();
  }
  assert.equal(run2.status, "proposed", run2.error);
  assert.equal(secondRequestedModel, "office-model-2b");
  assert.equal(run2.provider, "Office mock 2");
  assert.equal(run2.model, "office-model-2b");
  assert.equal(run2.edits[0].text, "Second provider proposal");
  assert.equal(
    (await (await request(`/api/office/documents/${doc.id}`)).json()).revision,
    saved.revision,
  );
  response = await request(`/api/office/documents/${doc.id}/download`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /wordprocessingml/);
  assert.equal(new Uint8Array(await response.arrayBuffer())[0], 80);
  child.kill();
  await once(child, "exit");
  await start();
  assert.equal(
    (await (await request(`/api/office/documents/${doc.id}`)).json()).revision,
    saved.revision,
  );
  assert.equal(
    (await (await request(`/api/office/ai/runs/${run.id}`)).json()).status,
    "unknown",
  );
  response = await request(`/api/office/documents/${doc.id}/restore`, "POST", {
    revision: saved.revision,
    target: doc.revision,
  });
  assert.equal(response.status, 200);
  const restored = await response.json();
  assert.notEqual(restored.revision, doc.revision);
  assert.equal(restored.history.at(-1).source, "restore");
  response = await request(`/api/office/documents/${doc.id}/rename`, "POST", { name: "議事録" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, "議事録.docx");
  assert.equal((await request(`/api/office/documents/${doc.id}/rename`, "POST", { name: "../x" })).status, 400);
  response = await request(`/api/office/documents/${doc.id}`, "DELETE");
  assert.equal(response.status, 200);
  assert.equal((await request(`/api/office/documents/${doc.id}`)).status, 404);
  assert.deepEqual(await (await request("/api/office/documents")).json(), []);
  const officeRoot = join(home, ".config", "opencode-pocket", "office");
  await rm(officeRoot, { recursive: true, force: true });
  await writeFile(officeRoot, "not a directory", { mode: 0o600 });
  response = await request(`/api/office/documents/${missingId}`);
  assert.equal(response.status, 500);
  const fsErrorBody = await response.text();
  assert.doesNotMatch(fsErrorBody, /ENOTDIR|ENOENT/);
  assert.ok(!fsErrorBody.includes(home), "response must not expose the server home path");
  assert.deepEqual(JSON.parse(fsErrorBody), { error: "文書を処理できませんでした。" });
});
