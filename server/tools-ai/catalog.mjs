import { isAbsolute } from "node:path";

export const CATALOG_VERSION = "tools-ai-read-v1";
const object = properties => ({ type: "object", properties, additionalProperties: false });
const integer = maximum => ({ type: "integer", minimum: 1, maximum });
const definitions = [
  ["git.inspect", object({ maxFiles: integer(10) }), "git", true, "project-read"],
  ["project.search", { ...object({ query: { type: "string", minLength: 1, maxLength: 200 }, limit: integer(20) }), required: ["query"] }, "search", true, "project-read"],
  ["project.map", object({}), "map", true, "project-read"],
  ["doc.read", { ...object({ path: { type: "string", minLength: 1, maxLength: 300, pattern: "\\.[mM][dD]$" } }), required: ["path"] }, "document", true, "project-read"],
  ["diagnostics.read", object({}), "diagnostics", false, "host-observation"]
];
export const OPERATIONS = Object.freeze(definitions.map(([operationId, inputSchema, outputType, projectRequirement, permission]) => Object.freeze({
  operationId, inputSchema, outputType, projectRequirement,
  requiredScope: projectRequirement ? "registered-project" : "authenticated-local-host",
  requiredPermissions: [permission],
  observationKind: permission === "host-observation" ? "bounded-exec-read" : "read",
  status: "supported", cancellationCapability: "non-cancellable",
  resultProjectionPolicy: { maxBytes: 24_000, maxItems: 40, maxSnippetBytes: 800, secretPolicy: "exclude-suspicious-content" }
})));

export function catalogFor(context) {
  return OPERATIONS.map(operation => ({ ...operation,
    status: (operation.projectRequirement && !context.project) || !operation.requiredPermissions.every(p => context.permissions?.includes(p)) ? "unavailable" : "supported"
  }));
}

export function safeMarkdownPath(value) {
  if (typeof value !== "string" || value.length > 300 || !value || isAbsolute(value) || /^[a-z]:/i.test(value) || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value) || value.split("/").some(p => p === "..") || !/\.md$/i.test(value)) {
    throw new Error("Markdown path must stay inside the selected project and end in .md");
  }
  return value;
}

export function validateProposal(value, context, catalog = catalogFor(context)) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Planner proposal must be an object");
  if (Object.keys(value).some(k => !["operationId", "input", "reason"].includes(k))) throw new Error("Unexpected planner field: scope is server-owned");
  const operation = catalog.find(item => item.operationId === value.operationId);
  if (!operation) throw new Error("Unknown operation");
  if (operation.status !== "supported") throw new Error("Operation unavailable for the selected scope");
  if (operation.projectRequirement && !context.project) throw new Error("Select a registered project");
  if (!operation.requiredPermissions.every(p => context.permissions?.includes(p))) throw new Error("Operation permission denied");
  const input = value.input;
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Operation input must be an object");
  const { properties, required = [] } = operation.inputSchema;
  if (Object.keys(input).some(key => !Object.hasOwn(properties, key))) throw new Error("Unexpected operation input; project/path scope cannot be replaced");
  for (const key of required) if (!Object.hasOwn(input, key)) throw new Error(`Missing ${key}`);
  for (const [key, val] of Object.entries(input)) {
    const schema = properties[key];
    if (schema.type === "integer" && (!Number.isInteger(val) || val < schema.minimum || val > schema.maximum)) throw new Error(`Invalid ${key}`);
    if (schema.type === "string" && (typeof val !== "string" || !val.trim() || val.length > schema.maxLength)) throw new Error(`Invalid ${key}`);
  }
  if (value.operationId === "doc.read") safeMarkdownPath(input.path);
  if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 500)) throw new Error("Invalid reason");
  return { operationId: operation.operationId, input: structuredClone(input), reason: value.reason || "" };
}

export const PROPOSAL_SCHEMA = {
  type: "object", required: ["operationId", "input"], additionalProperties: false,
  properties: { operationId: { enum: OPERATIONS.map(o => o.operationId) }, input: { type: "object" }, reason: { type: "string", maxLength: 500 } }
};
