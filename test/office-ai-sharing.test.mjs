import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeAi } from "../server/office/ai.mjs";

const identity = { ownerId: "owner:office-sharing-test" };
const payload = {
  documentId: "workbook",
  revision: "revision-1",
  goal: "Review this workbook",
  share: true,
};

function fixture(sheets, { secrets = [], reply = "Reviewed" } = {}) {
  const messages = [];
  const validations = [];
  const ai = createOfficeAi({
    store: {
      get: async () => ({
        id: payload.documentId,
        revision: payload.revision,
        format: "xlsx",
        sheets,
      }),
      validateCells: async (...args) => {
        validations.push(args);
        return args[2];
      },
    },
    authorize: async () => {},
    prepareChat: async () => ({
      context: { planner: { providerName: "Mock", model: "test" } },
      secrets,
      chat: async (input) => {
        messages.push(input);
        return reply;
      },
    }),
  });
  return { ai, messages, validations };
}

async function settled(ai, id) {
  for (let i = 0; i < 30; i++) {
    const run = ai.get(id, identity);
    if (run.status !== "planning") return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Office AI run did not settle");
}

function userData(messages) {
  assert.equal(messages.length, 1);
  return JSON.parse(messages[0].find((entry) => entry.role === "user").content);
}

test("workbook question and edit projections apply sharing policy to document metadata", async () => {
  const sensitive = "PrivateFixture123";
  const sheets = [
    { name: sensitive, cells: [{ ref: "A1", value: "synthetic" }] },
    { name: "Public", cells: [{ ref: "A1", value: 42 }] },
  ];
  const ask = fixture(sheets, { secrets: [sensitive] });
  const askRun = await ask.ai.ask(payload, identity);
  assert.equal((await settled(ask.ai, askRun.id)).status, "answered");
  assert.equal(askRun.sharing.excluded, 1);
  assert.deepEqual(userData(ask.messages).cells, [
    { cell: "Public!A1", text: "42", value: 42 },
  ]);
  assert.equal(JSON.stringify(ask.messages).includes(sensitive), false);

  const edit = fixture(sheets, {
    secrets: [sensitive],
    reply: JSON.stringify({ edits: [{ cell: "Public!B2", text: "7" }] }),
  });
  const editRun = await edit.ai.start(payload, identity);
  assert.equal((await settled(edit.ai, editRun.id)).status, "proposed");
  assert.deepEqual(userData(edit.messages).sheets, ["Public"]);
  assert.equal(JSON.stringify(edit.messages).includes(sensitive), false);
  assert.equal(edit.validations.length, 1);
});

test("workbook projections honor serialized data budget including formulas and metadata", async () => {
  const formula = "1+".repeat(180) + "1";
  const sheets = [{
    name: "Budget",
    cells: Array.from({ length: 150 }, (_, i) => ({
      ref: "A" + (i + 1), formula, value: 181,
    })),
  }];
  for (const mode of ["ask", "start"]) {
    const { ai, messages } = fixture(sheets, {
      reply: mode === "ask" ? "Reviewed" : JSON.stringify({
        edits: [{ cell: "Budget!B1", text: "1" }],
      }),
    });
    const run = await ai[mode](payload, identity);
    const final = await settled(ai, run.id);
    assert.equal(final.status, mode === "ask" ? "answered" : "proposed");
    const data = userData(messages);
    const projection = mode === "ask"
      ? { cells: data.cells }
      : { sheets: data.sheets, cells: data.cells };
    assert.ok(Buffer.byteLength(JSON.stringify(projection)) <= 24000);
    assert.ok(data.cells.length > 0 && data.cells.length < 150);
    assert.equal(data.cells[0].formula, formula);
    assert.equal(run.sharing.truncated, true);
  }
});

test("edit proposals cannot target sheets omitted by the sharing policy", async () => {
  const { ai, validations } = fixture([
    { name: "PrivateFixture123", cells: [] },
    { name: "Public", cells: [] },
  ], {
    secrets: ["PrivateFixture123"],
    reply: JSON.stringify({ edits: [{ cell: "PrivateFixture123!A1", text: "7" }] }),
  });
  const run = await ai.start(payload, identity);
  assert.equal((await settled(ai, run.id)).status, "failed");
  assert.equal(validations.length, 0);
});

test("workbook with no shareable sheets is rejected before model invocation", async () => {
  const { ai, messages } = fixture([
    { name: "PrivateFixture123", cells: [{ ref: "A1", value: 1 }] },
  ], { secrets: ["PrivateFixture123"] });
  await assert.rejects(ai.start(payload, identity));
  await assert.rejects(ai.ask(payload, identity));
  assert.equal(messages.length, 0);
});
