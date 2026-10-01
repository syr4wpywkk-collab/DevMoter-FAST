import { catalogFor, validateProposal } from "./catalog.mjs";
import { projectResult, sensitivePath } from "./projection.mjs";

export function createDispatcher({ resolveProject, gitStatus, changedFiles, fileDiff, index, readMarkdown, diagnostics }) {
  return async function dispatch(proposal, context, { signal, secrets = [] } = {}) {
    const validated = validateProposal(proposal, context, catalogFor(context));
    signal?.throwIfAborted();
    let project = null;
    if (context.project) {
      project = await resolveProject(context.project.id);
      if (project.id !== context.project.id || project.path !== context.project.path) throw new Error("Project scope changed since the run started");
    }
    signal?.throwIfAborted();
    const { operationId, input } = validated;
    let type; let raw;
    if (operationId === "git.inspect") {
      type = "git";
      const status = await gitStatus(project.path);
      signal?.throwIfAborted();
      const files = await changedFiles(project.path, { limit: input.maxFiles || 5, offset: 0 });
      const diffs = [];
      for (const file of files.files) {
        // Stop cannot kill a running helper, but it MUST suppress every later helper call.
        signal?.throwIfAborted();
        if (sensitivePath(file.path)) { diffs.push({ path: file.path, diff: "[安全上、内容を除外]", excluded: true }); continue; }
        diffs.push(await fileDiff(project.path, file.path, { scope: "all" }));
      }
      raw = { source: "project-git-helpers", status, files, diffs };
    } else if (operationId === "project.search" || operationId === "project.map") {
      type = operationId === "project.search" ? "search" : "map";
      const state = await index.status(project.id);
      signal?.throwIfAborted();
      if (!state.ready) raw = { source: "saved-project-index", unavailable: true, builtAt: null, message: "Project indexが未構築です。自動rebuildは行いません。" };
      else if (type === "search") raw = { ...await index.search(project.id, input.query, input.limit || 10), source: "saved-project-index" };
      else {
        const map = await index.repoMap(project.id);
        raw = { ...map, totalFiles: map.files.length, source: "saved-project-index" };
      }
    } else if (operationId === "doc.read") {
      type = "document";
      if (sensitivePath(input.path)) raw = { source: "project-markdown-helper", unavailable: true, message: "この文書はcredential関連pathのため共有対象から除外しました。" };
      else raw = { ...await readMarkdown(project, input.path), source: "project-markdown-helper" };
    } else if (operationId === "diagnostics.read") {
      type = "diagnostics";
      const report = await diagnostics();
      raw = { source: "bounded-host-diagnostics", prerequisites: report.prerequisites, backends: report.backends, network: report.network, app: { version: report.app.version } };
    }
    return projectResult(type, raw, secrets);
  };
}
