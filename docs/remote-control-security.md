# Remote control security notes

## Passkeys

Passkeys are optional. Credentials are scoped to the exact DevMoter RP ID (host name) and are never reused as backend credentials.

By default, the first passkey for an origin can only be registered through a true local loopback browser origin. A reverse proxy that merely connects to DevMoter over 127.0.0.1 does not count as local bootstrap because the browser host name is also checked.

For a new remote origin or recovery flow, temporarily start DevMoter with:

```bash
DEVMOTER_PASSKEY_BOOTSTRAP=1
```

Register the passkey for the intended HTTPS origin, then remove/disable that variable and restart DevMoter.

To require passkey authentication for normal API routes after credentials are configured:

```bash
DEVMOTER_PASSKEY_REQUIRED=1
```

Recovery policy:

- keep at least two passkeys when practical;
- an already authenticated passkey session may register another passkey for the same RP ID;
- a new/recovery RP ID requires the explicit temporary bootstrap flag;
- restarting DevMoter clears in-memory login sessions, so the user signs in again;
- deleting the passkey registry manually is an administrator recovery action and should only be done from the trusted host.

GitHub webhook delivery is not authenticated with the browser passkey cookie. It is separately authenticated using the per-trigger HMAC secret.

## Multi-host registry

The host registry stores only a label, HTTP(S) address, trust state, and timestamps. It rejects addresses with embedded usernames/passwords and has no field for SSH private keys.

Remote hosts are opened as their own origins. Their browser storage, passkeys, backend sessions, projects, and credentials remain host-local. The registry does not copy authentication material between hosts.

Host health refresh is bounded and cached. It distinguishes online, authentication-required, timeout, and offline states.

## Scheduled tasks

Every schedule records its cron-like five-field rule, timezone, project, backend, optional agent/model, task text, enabled state, and last-run state. Schedules are visible through the control center and can be paused/resumed or deleted.

Scheduled runs use normal Codex/OpenCode permission and approval flows. DevMoter does not auto-approve an operation just because it was scheduled.

## Event triggers

Triggers are explicit records with source, event name, task, project/backend context, minimum interval, and concurrency limit.

GitHub webhooks use a per-trigger HMAC secret. The secret is shown once when the trigger is created and is stored server-side afterward.

Incoming event payloads are size-limited and injected into the task as explicitly untrusted data. Event content cannot disable DevMoter approval/permission policy.

## Bounded autopilot

Before start, autopilot records:

- maximum turns;
- maximum elapsed minutes;
- optional maximum reported cost;
- project/backend/model/agent context;
- task text.

Runs are visible and can be paused, resumed, or cancelled. Interrupt requests are sent to the active backend when possible.

For cost-bounded runs, if the backend does not provide cost telemetry, DevMoter stops on the safe side instead of pretending the budget can be enforced.

The agent is asked to emit `[DEVMOTER_AUTOPILOT_DONE]` only when the task is actually complete. Otherwise the server continues until a configured boundary is reached. Existing approval-required operations remain approval-required.
