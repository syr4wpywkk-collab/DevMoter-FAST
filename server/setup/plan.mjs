import { createSetupStatus, setupAdapters } from "./engine.mjs";

const REQUEST_ACTIONS = new Set(["install", "keep", "manual_review"]);
const AUTOMATIC_SOURCE_CLASSES = new Set(["A", "B"]);
const TOOL_BY_ID = new Map(setupAdapters.map(adapter => [adapter.id, adapter]));

export class SetupPlanError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "SetupPlanError";
    this.code = code;
    this.status = status;
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, requiredKeys, allowedKeys = requiredKeys) {
  const keys = Object.keys(value);
  return requiredKeys.every(key => Object.hasOwn(value, key)) &&
    keys.every(key => allowedKeys.includes(key));
}

function parseSelections(payload) {
  if (!isPlainRecord(payload) || !exactKeys(payload, ["selections"])) {
    throw new SetupPlanError("invalid_request");
  }
  if (!Array.isArray(payload.selections) || payload.selections.length < 1 || payload.selections.length > setupAdapters.length) {
    throw new SetupPlanError("invalid_selections");
  }

  const selections = new Map();
  for (const selection of payload.selections) {
    if (!isPlainRecord(selection) || !exactKeys(selection, ["toolId", "action"])) {
      throw new SetupPlanError("invalid_selection");
    }
    if (typeof selection.toolId !== "string" || !TOOL_BY_ID.has(selection.toolId)) {
      throw new SetupPlanError("unknown_tool");
    }
    if (typeof selection.action !== "string" || !REQUEST_ACTIONS.has(selection.action)) {
      throw new SetupPlanError("unknown_action");
    }
    if (selections.has(selection.toolId)) throw new SetupPlanError("duplicate_tool");
    selections.set(selection.toolId, selection.action);
  }
  return selections;
}

function fixedMetadata(adapter) {
  const source = adapter.installSource;
  const supported = adapter.installSupport === "supported" &&
    (adapter.installStatus === "candidate" || adapter.installStatus === "confirmation-required" || adapter.installStatus === "manual-review") &&
    ["A", "B", "C", "D"].includes(adapter.installSourceClass) &&
    source && typeof source.type === "string" && typeof source.publisher === "string" && typeof source.label === "string";
  return {
    installSupport: supported ? adapter.installSupport : "blocked",
    installSourceClass: supported ? adapter.installSourceClass : null,
    installStatus: supported ? adapter.installStatus : "blocked",
    requiresPrivilege: ["user", "administrator", "unknown"].includes(adapter.requiresPrivilege) ? adapter.requiresPrivilege : "unknown",
    source: supported ? { type: source.type, publisher: source.publisher, label: source.label } : null,
    changes: supported && Array.isArray(adapter.installChanges) ? adapter.installChanges.filter(item => typeof item === "string").slice(0, 8) : [],
    verification: supported && Array.isArray(adapter.installVerification) ? adapter.installVerification.filter(item => typeof item === "string").slice(0, 8) : [],
    notes: Array.isArray(adapter.notes) ? adapter.notes.filter(item => typeof item === "string").slice(0, 8) : []
  };
}

export function installSourceDecision(metadata) {
  if (metadata.installSupport !== "supported" || metadata.installStatus === "blocked" || metadata.installSourceClass === "D") return "blocked";
  if (metadata.installSourceClass === "C" || metadata.installStatus === "confirmation-required") return "confirmation-required";
  if (metadata.installStatus === "manual-review") return "manual-review";
  if (AUTOMATIC_SOURCE_CLASSES.has(metadata.installSourceClass) && metadata.installStatus === "candidate") return "reviewable";
  return "blocked";
}

function makePlanItem(adapter, current, requestedAction) {
  const metadata = fixedMetadata(adapter);
  const currentState = typeof current?.state === "string" ? current.state : "unknown";
  const installed = current?.installed === true;
  let action = requestedAction;
  let status = "reviewable";
  let notes = metadata.notes.slice();
  let changes = metadata.changes.slice();
  let verification = metadata.verification.slice();

  if (currentState === "unsupported") {
    if (requestedAction === "install") throw new SetupPlanError("unsupported_tool", 422);
    action = "unavailable";
    status = "unsupported";
    changes = [];
    verification = [];
  } else if (currentState === "broken" || currentState === "unknown" || !current) {
    action = "manual_review";
    status = "manual-review";
    changes = [];
    verification = [];
    notes.push(currentState === "broken" ? "The existing installation is broken; automatic repair is not planned." : "The machine state is unknown; rescan or review manually before planning installation.");
  } else if (installed || ["installed", "ready", "auth_required"].includes(currentState)) {
    action = "keep";
    status = "kept";
    changes = [];
    verification = [];
    notes.push("Existing installation is preserved; reinstall is not planned.");
  } else if (requestedAction === "keep") {
    action = "keep";
    status = "kept";
    changes = [];
    verification = [];
  } else if (requestedAction === "manual_review") {
    action = "manual_review";
    status = "manual-review";
    notes.push("Manual review selected; this entry cannot be executed in Phase 2.");
  } else {
    const decision = installSourceDecision(metadata);
    if (decision === "reviewable") {
      status = "reviewable";
    } else if (decision === "confirmation-required") {
      status = "confirmation-required";
      notes.push("This source is preview-only. A later install phase must present it and obtain explicit confirmation before any execution.");
    } else if (decision === "manual-review") {
      action = "manual_review";
      status = "manual-review";
      notes.push("Additional platform or compatibility review is required before this plan can be considered for installation.");
    } else {
      action = "manual_review";
      status = decision;
      changes = [];
      verification = [];
      if (decision === "blocked") notes.push("No automatic installation candidate is available for this source.");
    }
  }

  return {
    toolId: adapter.id,
    displayName: adapter.displayName,
    currentState,
    detectedVersion: typeof current?.version === "string" ? current.version : null,
    requestedAction,
    action,
    status,
    installSupport: metadata.installSupport,
    installSourceClass: metadata.installSourceClass,
    requiresPrivilege: metadata.requiresPrivilege,
    source: metadata.source,
    changes,
    verification,
    notes
  };
}

export function buildInstallPlan(payload, setupStatus) {
  const selections = parseSelections(payload);
  if (!isPlainRecord(setupStatus) || !Array.isArray(setupStatus.tools)) {
    throw new SetupPlanError("machine_state_unavailable", 503);
  }
  const currentById = new Map(setupStatus.tools.filter(item => item && typeof item.id === "string").map(item => [item.id, item]));
  const items = [];
  for (const adapter of setupAdapters) {
    if (!selections.has(adapter.id)) continue;
    const current = setupStatus.platform?.supported === true
      ? currentById.get(adapter.id)
      : { id: adapter.id, state: "unsupported", installed: false, version: null };
    items.push(makePlanItem(adapter, current, selections.get(adapter.id)));
  }

  return {
    phase: "experimental-phase-2",
    mode: "preview-only",
    executable: false,
    items,
    summary: {
      selected: items.length,
      keep: items.filter(item => item.action === "keep").length,
      install: items.filter(item => item.action === "install").length,
      manualReview: items.filter(item => item.action === "manual_review").length,
      unavailable: items.filter(item => item.action === "unavailable").length
    }
  };
}

export async function previewInstallPlan(payload) {
  const setupStatus = await createSetupStatus();
  return buildInstallPlan(payload, setupStatus);
}
