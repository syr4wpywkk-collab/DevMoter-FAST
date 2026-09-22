# DevMoter automation API

DevMoter FAST exposes a small supported automation surface for scripts and CI.

## Compatibility

The client and machine-readable event envelopes use API version **1**. Additive fields may be introduced without a version bump. Removing or changing the meaning of an existing v1 field requires a new API version.

Automation should use the supported client in `sdk/index.mjs` or the `devmoter` CLI instead of calling OpenCode or Codex directly. This keeps project validation, server authentication, operation-ID duplicate suppression, and backend allowlists in one place.

## CLI

```bash
devmoter status --json
devmoter projects --json
devmoter sessions --project my-project --json
devmoter open my-project
devmoter task --project my-project --agent build --task "Run the tests" --json
devmoter task --project my-project --agent build --task "Run the tests" --stream-json
```

`--stream-json` writes one versioned JSON event per stdout line. Human diagnostics go to stderr so stdout remains safe for parsers.

## SDK

```js
import { DevMoterClient } from "./sdk/index.mjs";

const client = new DevMoterClient({
  baseUrl: "http://127.0.0.1:8787"
});

console.log(await client.health());
console.log(await client.projects());

const result = await client.runTask({
  project: "my-project",
  agent: "build",
  backend: "opencode",
  task: "Run the unit tests and summarize failures."
});
```

The client accepts `DEVMOTER_URL` and optional `DEVMOTER_TOKEN` environment variables.

## Safety boundaries

Project arguments resolve only against DevMoter's registered project registry. The automation project list does not expose host paths. Context references are project-relative, reject traversal and symlinks, exclude common secret/build directories, and enforce per-file, total-size, depth, and file-count bounds.
