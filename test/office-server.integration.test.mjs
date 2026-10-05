import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Office real HTTP: owner/origin gates, edits, provider adapter, download and restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "office-http-"));
  const password = "office-http-test-password-2026";
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
  let shared;
  const mock = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const payload = JSON.parse(data);
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
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
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
        8000,
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
    await new Promise((r) => mock.close(r));
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
  let response = await request("/api/office/documents", "POST", {
    blank: true,
    name: "Integration.docx",
  });
  assert.equal(response.status, 201);
  const doc = await response.json();
  const saved = await (
    await request(`/api/office/documents/${doc.id}`, "PATCH", {
      revision: doc.revision,
      edits: [
        {
          blockId: doc.blocks.find((b) => b.editable).id,
          text: "Read this text\nSecond paragraph",
        },
      ],
    })
  ).json();
  assert.equal(saved.blocks.filter((b) => b.editable).length, 2);
  assert.equal(
    (
      await request(`/api/office/documents/${doc.id}`, "PATCH", {
        revision: doc.revision,
        edits: [{ blockId: "b0", text: "stale" }],
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
    models: ["office-model"],
  });
  assert.equal(response.status, 200);
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
  assert.equal(shared.blocks[0].text, "Read this text");
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
});
