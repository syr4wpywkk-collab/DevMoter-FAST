import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createAgentRunApi } from "../server/agent-run-api.mjs";

function request(method = "GET", body = "") {
  const req = new EventEmitter();
  req.method = method;
  req[Symbol.asyncIterator] = async function* () {
    if (body) yield Buffer.from(body);
  };
  return req;
}

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers || {};
    },
    write(chunk) {
      this.body += String(chunk);
      return true;
    },
    end(body = "") {
      this.body += String(body);
    }
  };
}

test("agent run API fails closed without a trusted device", async () => {
  const service = {
    async list() { throw new Error("must not read state"); }
  };
  const api = createAgentRunApi({
    service,
    authenticateDevice: async () => null
  });
  const res = responseRecorder();
  const handled = await api.handle(
    request("GET"),
    res,
    new URL("http://localhost/api/agent-runs")
  );
  assert.equal(handled, true);
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error, "Trusted device required");
});

test("agent run mutations use the existing idempotent operation boundary", async () => {
  const calls = [];
  const claims = [];
  const service = {
    async spawn(spec) {
      calls.push(spec);
      return { id: "run-1", state: "running" };
    }
  };
  const api = createAgentRunApi({
    service,
    authenticateDevice: async () => ({ id: "device-1" }),
    claimOperation(_req, _res, scope) {
      claims.push(scope);
      return true;
    }
  });
  const res = responseRecorder();
  await api.handle(
    request("POST", JSON.stringify({
      spec: {
        parentSessionId: "parent",
        task: "review",
        context: { projectId: "project-1" }
      }
    })),
    res,
    new URL("http://localhost/api/agent-runs")
  );

  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
  assert.deepEqual(claims, ["agent-runs:device-1:spawn"]);
});

test("agent approval API validates decisions before touching the host runtime", async () => {
  let approvals = 0;
  const api = createAgentRunApi({
    service: {
      async respondApproval() {
        approvals += 1;
        return {};
      }
    },
    authenticateDevice: async () => ({ id: "device-1" }),
    claimOperation: () => true
  });
  const res = responseRecorder();
  await api.handle(
    request("POST", JSON.stringify({ decision: "always-allow-everything" })),
    res,
    new URL("http://localhost/api/agent-runs/run-1/approval")
  );
  assert.equal(res.status, 400);
  assert.equal(approvals, 0);
  assert.match(JSON.parse(res.body).error, /Unsupported approval decision/);
});
