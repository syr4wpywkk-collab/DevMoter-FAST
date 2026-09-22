# DevMoter automation API

DevMoter FAST exposes a small supported automation surface for scripts and CI.

## Compatibility

The client and machine-readable event envelopes use API version **1**. Additive fields may be introduced without a version bump. Removing or changing the meaning of an existing v1 field requires a new API version.

Automation should use the supported client in `sdk/index.mjs` or the `devmoter` CLI instead of calling OpenCode or Codex directly. This keeps registered-project validation, DevMoter authentication, same-origin mutation checks, operation-ID duplicate suppression, and backend allowlists in one place.

## Authentication

Headless automation uses the same DevMoter HTTP Basic boundary as the browser.

The CLI resolves the password in this order:

1. `--password-file <path>`
2. `DEVMOTER_AUTH_PASSWORD`
3. the normal local password file at `~/.config/opencode-pocket/devmoter-auth-password` for loopback targets

The username defaults to `devmoter` and can be changed with `--username` or `DEVMOTER_AUTH_USERNAME`.

The SDK accepts `username` / `password` or the same environment variables. Mutating SDK calls automatically send the target Origin and an operation ID, so they pass through the same auth/origin/deduplication boundary as browser mutations.

For remote hosts, use HTTPS. The SDK refuses plain HTTP unless the target is localhost/loopback.

If optional `DEVMOTER_PASSKEY_REQUIRED=1` is enabled, the passkey gate still applies; the automation client does not bypass it.

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
  baseUrl: "http://127.0.0.1:8787",
  username: "devmoter",
  password: process.env.DEVMOTER_AUTH_PASSWORD
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

## Safety boundaries

Project arguments resolve only against DevMoter's registered project registry. The automation project list does not expose host paths. Context references are project-relative, reject traversal and symlinks, exclude common secret/build directories, and enforce per-file, total-size, depth, and file-count bounds.

Headless task execution does not create a separate auto-approval channel. Codex approval requests return a blocked result and remain visible in DevMoter. Task timeouts interrupt the known backend turn/session before the request is reported failed.
