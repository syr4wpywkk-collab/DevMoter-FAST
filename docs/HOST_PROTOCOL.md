# DevMoter Host Protocol v1

The Host Protocol gives clients one OS-neutral way to identify the DevMoter runtime and discover which operations that runtime actually supports. A capability marked unavailable must be treated as unavailable; clients must not infer support from the OS name or call a lower-level endpoint as a fallback.

## Discovery endpoint

`GET /api/host` returns a server-generated snapshot behind the normal DevMoter authentication boundary:

```json
{
  "protocolVersion": "1.0",
  "host": {
    "id": "local",
    "platform": "linux",
    "runtime": "native",
    "architecture": "x64",
    "protocolVersion": "1.0"
  },
  "capabilities": {
    "terminal": {
      "state": "available",
      "reason": null,
      "features": ["pty", "ndjson-stream", "project-cwd"]
    },
    "secrets": {
      "state": "unavailable",
      "reason": "host_vault_not_implemented",
      "features": []
    }
  }
}
```

The full capability map always includes `terminal`, `files`, `processes`, `services`, `ports`, `git`, `browser`, `secrets`, `agents`, and `notifications`. Missing capabilities fail closed to `unavailable`.

`host.id` is local to this DevMoter origin. Remote host identity and trust still use the existing authenticated host registry; the registry's trust label is not authorization. The response intentionally omits hostname, account name, home directory, raw executable paths, environment variables, commands, and credentials.

## Capability states

| State | Meaning | Client behavior |
|---|---|---|
| `available` | This adapter exposes the named capability. | Show it and use only its documented feature/API surface. |
| `degraded` | Some support exists, but an explicit runtime limitation applies. | Show the limitation; do not silently retry through another OS path. |
| `unavailable` | No usable adapter is configured or the feature is not implemented. | Disable the operation and display the bounded reason code. |

`reason` is a machine-readable code, never free-form diagnostic output. `features` contains bounded identifiers, not commands or URLs.

## Platform adapters

- **LinuxHost:** advertises the existing registered-project Files, Git, agent, notifications, and terminal surfaces. Terminal is unavailable until DevMoter authentication is configured.
- **WindowsWSLHost:** used when DevMoter is actually running inside WSL. It advertises only the capabilities supported by that Linux runtime. A native Windows process without a connected WSL engine reports all capabilities unavailable with `wsl_engine_not_connected`.
- **MacOSHost:** currently reports capabilities unavailable with `macos_adapter_not_implemented`; this prevents Linux-specific behavior from being presented as supported on macOS before a native adapter is implemented and verified.

The v1 endpoint is a discovery contract. It does not yet replace the existing capability-specific HTTP APIs or provide process/service/port/secret/browser operations. Clients must keep using authenticated routes and their existing project/session ownership checks until those operations migrate behind Host adapters.
