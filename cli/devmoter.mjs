#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  DevMoterClient,
  DevMoterError,
  createEventEnvelope
} from "../sdk/index.mjs";

export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  NOT_FOUND: 4,
  SERVER: 5,
  TASK_FAILED: 6
});

function usage() {
  return [
    "DevMoter FAST CLI",
    "",
    "Usage:",
    "  devmoter status [--json]",
    "  devmoter projects [--json]",
    "  devmoter open <project> [--browser] [--json]",
    "  devmoter sessions [--project <id|name>] [--agent <name>] [--status <state>] [--backend <name>] [--json]",
    '  devmoter task --project <id|name> --agent <name> --task <text> [--backend opencode|codex] [--model <id>] [--json|--stream-json]',
    "",
    "Global:",
    "  --url <url>       DevMoter server (or DEVMOTER_URL)",
    "  --token <token>   Optional server token (or DEVMOTER_TOKEN)",
    "",
    "Exit codes: 0 success, 2 usage, 4 not found, 5 server/network error, 6 task failed."
  ].join("\n");
}

export function parseArgs(argv) {
  const args = [...argv];
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["json", "stream-json", "browser", "help"].includes(key)) {
      options[key] = true;
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`--${key} requires a value`);
    options[key] = next;
    i += 1;
  }
  return { command: positional.shift() || "", positional, options };
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printTable(rows, columns) {
  if (!rows.length) return;
  const widths = columns.map(col =>
    Math.max(col.label.length, ...rows.map(row => String(row[col.key] ?? "").length))
  );
  process.stdout.write(columns.map((col, i) => col.label.padEnd(widths[i])).join("  ") + "\n");
  for (const row of rows) {
    process.stdout.write(columns.map((col, i) => String(row[col.key] ?? "").padEnd(widths[i])).join("  ") + "\n");
  }
}

function fixedBrowserCommand(url) {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return EXIT.USAGE;
  }

  const { command, positional, options } = parsed;
  if (options.help || !command) {
    process.stdout.write(`${usage()}\n`);
    return options.help ? EXIT.OK : EXIT.USAGE;
  }

  const client = new DevMoterClient({
    baseUrl: options.url || process.env.DEVMOTER_URL,
    token: options.token || process.env.DEVMOTER_TOKEN
  });

  try {
    if (command === "status") {
      const health = await client.health();
      if (options.json) writeJson(health);
      else {
        const rows = Object.entries(health.backends || {}).map(([name, info]) => ({
          backend: name,
          state: info?.online ? "online" : "offline",
          version: info?.version || health.version || ""
        }));
        printTable(rows, [
          { key: "backend", label: "BACKEND" },
          { key: "state", label: "STATE" },
          { key: "version", label: "VERSION" }
        ]);
      }
      return health.online ? EXIT.OK : EXIT.SERVER;
    }

    if (command === "projects") {
      const payload = await client.projects();
      const projects = payload.projects || [];
      if (options.json) writeJson(payload);
      else printTable(projects, [
        { key: "id", label: "ID" },
        { key: "name", label: "NAME" },
        { key: "available", label: "AVAILABLE" }
      ]);
      return EXIT.OK;
    }

    if (command === "open") {
      const project = positional[0];
      if (!project) throw new Error("open requires a project id or name");
      const payload = await client.openProject(project);
      if (options.json) writeJson(payload);
      else process.stdout.write(`${payload.url}\n`);
      if (options.browser) {
        const [bin, args] = fixedBrowserCommand(payload.url);
        const child = spawn(bin, args, { detached: true, stdio: "ignore" });
        child.unref();
      }
      return EXIT.OK;
    }

    if (command === "sessions") {
      const payload = await client.sessions({
        project: options.project || "",
        agent: options.agent || "",
        status: options.status || "",
        backend: options.backend || ""
      });
      const sessions = payload.sessions || [];
      if (options.json) writeJson(payload);
      else printTable(sessions, [
        { key: "backend", label: "BACKEND" },
        { key: "id", label: "ID" },
        { key: "title", label: "TITLE" },
        { key: "agent", label: "AGENT" },
        { key: "status", label: "STATUS" }
      ]);
      return EXIT.OK;
    }

    if (command === "task") {
      const project = options.project;
      const agent = options.agent;
      const task = options.task;
      const backend = options.backend || "opencode";
      if (!project || !agent || !task) {
        throw new Error("task requires --project, --agent, and --task");
      }
      if (!["opencode", "codex"].includes(backend)) {
        throw new Error("--backend must be opencode or codex");
      }

      const opId = "cli-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      const taskInput = {
        project,
        agent,
        task,
        backend,
        model: options.model || ""
      };

      if (options["stream-json"]) {
        writeJson(createEventEnvelope(
          "task.accepted",
          { project, agent, backend },
          { operationId: opId }
        ));

        let finalResult = null;
        for await (const event of client.streamTask(taskInput, { operationId: opId })) {
          writeJson(event);
          if (event?.type === "task.result") finalResult = event.data;
          if (event?.type === "task.error") finalResult = { status: "failed" };
        }

        return ["failed", "blocked"].includes(finalResult?.status)
          ? EXIT.TASK_FAILED
          : EXIT.OK;
      }

      const result = await client.runTask(taskInput, { operationId: opId });

      if (options.json) {
        writeJson(createEventEnvelope("task.result", result, { operationId: opId }));
      } else {
        process.stdout.write(String(result.output || result.message || "Task submitted") + "\n");
        if (result.sessionId) process.stderr.write("session: " + result.sessionId + "\n");
      }
      return ["failed", "blocked"].includes(result.status) ? EXIT.TASK_FAILED : EXIT.OK;
    }

    process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
    return EXIT.USAGE;
  } catch (error) {
    const notFound = error instanceof DevMoterError && error.status === 404;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return notFound ? EXIT.NOT_FOUND : error instanceof DevMoterError ? EXIT.SERVER : EXIT.USAGE;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = await main();
}
