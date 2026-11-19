# OpenCode Upstream Credential & Process Boundary

Investigation note for issue #589, based on a source review of commit
`780e6ca` (plus the permission fix described in §3, made with this note).
It documents how the OpenCode server password is generated, stored, and
handed over, whether the upstream authenticates, and what boundary
remains against other processes running as the same OS user.

Scope statement up front: DevMoter's proxy controls (agent-mode /
read-only enforcement, adapter-owned routes, sandbox policy) are a
**proxy-layer** boundary. They are not an OS boundary. §5 states the
resulting residual risk plainly; it is accepted, not fixed, by this
note. The redesign options in §7 are future work and are **not
implemented**.

## 1. Where the credential lives

Two launcher scripts manage the credential; no server code creates it.

| | `scripts/start-pocket.sh` | `scripts/systemd-entrypoint.sh` |
| --- | --- | --- |
| State dir | `STATE_DIR` = `${XDG_CONFIG_HOME:-$HOME/.config}/opencode-pocket` (line 8) | same (line 8) |
| Password file | `$STATE_DIR/opencode-server-password` (line 9) | `$STATE_DIR/opencode-server-password` (line 9) |
| Creation | inline block, lines 26–35 | `ensure_secret()`, lines 61–74 |

DevMoter's own inbound auth password (`devmoter-auth-password`, same
directory) follows the identical lifecycle in both scripts
(`start-pocket.sh` lines 10, 39–51; `systemd-entrypoint.sh` lines 10,
78–84). Everything below applies to it equally, except where noted.

## 2. Credential lifecycle

### Generation
- Created only when the file is missing or empty (`[ ! -s "$file" ]`).
- Generator: `python3` with `secrets.token_urlsafe(32)` — 32 random
  bytes, a 43-character URL-safe token (`start-pocket.sh` lines 27–30;
  `systemd-entrypoint.sh` lines 64–67).
- The value is written by shell redirection (`> "$SECRET_FILE"`).

### Storage and permissions
- Directory: `mkdir -p "$STATE_DIR"` followed by an unconditional
  `chmod 700` (`start-pocket.sh` lines 23–24;
  `systemd-entrypoint.sh` lines 58–59).
- File: `chmod 600` at creation, and re-applied on every start
  outside the creation branch, so a pre-existing file's mode is
  repaired rather than inherited (see §3) (`start-pocket.sh` lines
  35 and 49; `systemd-entrypoint.sh` line 72, inside
  `ensure_secret()`).
- Nothing else in the repository reads or writes this file: the server
  receives the password only via its environment (below). A grep for
  the file name across `server/`, `src/`, and `scripts/` finds only
  the two launchers.
- Existing static guardrails in `scripts/security-audit.mjs`
  (lines 49–51) assert the `chmod 700`/`chmod 600` lines stay in
  `start-pocket.sh`.

### Handoff
1. The launcher reads the file into a shell variable
   (`PASS="$(cat "$SECRET_FILE")"`, `start-pocket.sh` line 37;
   `OC_PASS=...`, `systemd-entrypoint.sh` line 76).
2. It starts OpenCode with the credential in the process environment:
   `OPENCODE_SERVER_USERNAME=opencode OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --hostname 127.0.0.1 --port "$OC_PORT"`
   (`start-pocket.sh` line 93; `systemd-entrypoint.sh` lines 97–100).
   The bind is loopback-only.
3. It starts DevMoter the same way, adding
   `OPENCODE_URL=http://127.0.0.1:$OC_PORT`
   (`start-pocket.sh` line 148; `systemd-entrypoint.sh` lines
   163–174).
4. The launchers' own readiness probes authenticate with the same
   credential (`oc_get()` uses `curl -u "opencode:$PASS"`,
   `start-pocket.sh` lines 105–106; `systemd-entrypoint.sh`
   lines 113–115) — so during startup the password also appears
   transiently in `curl`'s argument list.
5. In the server, `server.mjs` reads the environment once at startup
   (lines 64–66: `OPENCODE_URL`, `OPENCODE_SERVER_USERNAME` default
   `opencode`, `OPENCODE_SERVER_PASSWORD`) and `openCodeHeaders()`
   (lines 497–507) turns it into
   `Authorization: Basic base64(user:password)` on every upstream
   request, via the client in `server/opencode-api.mjs`
   (`createOpenCodeClient`, line 60; the header callback is applied to
   every `fetchJson` call). The password is also in `REDACTED_SECRETS`
   (`server.mjs` line 87), so DevMoter's proxy/log redaction scrubs it
   from output.

### Rotation and disposal — do not exist
- **No rotation.** No code anywhere in the repository rotates,
  expires, or re-issues the password. Because creation is guarded by
  `[ ! -s ]`, every restart silently reuses the first generated value
  forever. (Verified by test: two bootstrap runs produce identical
  file contents.)
- **No disposal.** No script deletes the password file. The stop
  logic removes only pid files (`start-pocket.sh` lines 52–67).
- The de-facto rotation procedure is manual and implicit: stop both
  processes, delete `opencode-server-password`, start again. The next
  launch generates a fresh token and hands it to both processes
  consistently. Deleting the file while OpenCode keeps running would
  desync DevMoter from the still-running upstream until OpenCode is
  also restarted.

## 3. Permission finding and fix

As originally written, both launchers created the password file by
shell redirection under the caller's umask and only afterwards ran
`chmod 600`. With a typical umask of 022 the file therefore existed —
with the secret already written into it — at mode 644 until the chmod
ran, and if the script was interrupted in between, the weaker mode
persisted (the chmod is never re-applied to an existing file).

Fix made with this note (both launchers): each bootstrap now saves
the caller's umask and sets `umask 077` before creating the directory
and secret files, restoring the original umask once both secrets are
in place (`start-pocket.sh` lines 16–21 and line 53;
`systemd-entrypoint.sh` lines 51–56 and line 86). The credentials are
owner-only from the moment they exist; the existing
`chmod 700`/`chmod 600` lines remain as a second layer.

The same change also closes the pre-existing-file half of the
finding: both scripts now re-apply `chmod 600` to the password files
on **every** start, not only in the creation branch
(`start-pocket.sh` lines 35 and 49; `systemd-entrypoint.sh` line 72,
inside `ensure_secret()`). A secret file left at mode 644 by an
interrupted pre-fix bootstrap is therefore repaired automatically on
the next start, instead of being reused at the weaker mode forever.

Manual remediation for existing installs is optional — the next
start already repairs the modes — but anyone who wants to fix them
immediately can stop DevMoter, run
`chmod 600 ~/.config/opencode-pocket/opencode-server-password ~/.config/opencode-pocket/devmoter-auth-password`,
and start again. (Deleting the files instead also works, but then
both processes must be restarted so they agree on the fresh values;
see §2.)

## 4. Is upstream authentication enforced?

- **By the launch configuration, yes.** Both launchers always start
  OpenCode with `OPENCODE_SERVER_PASSWORD` set, which makes OpenCode
  require HTTP Basic authentication (user `opencode`) for its API.
  DevMoter's readiness probes and health gate are built on that: they
  authenticate with the credential and fail (`curl -f`) when it is
  rejected.
- **DevMoter's client fails closed.** `fetchJson` in
  `server/opencode-api.mjs` turns any non-2xx upstream answer into a
  thrown error carrying the HTTP status; there is no retry or fallback
  that proceeds unauthenticated. Test 3 in
  `test/opencode-upstream-boundary.test.mjs` shows a wrong or absent
  credential surfacing as a 401 error, while the configured credential
  succeeds.
- **But DevMoter itself does not verify that the upstream demands
  authentication.** `openCodeHeaders()` adds the header only when
  `OPENCODE_PASSWORD` is non-empty (line 502); if DevMoter is started
  without the variable — or pointed at an OpenCode started without
  one — the two talk with no credential and nothing complains.
  Enforcement is a property of the launcher scripts, not of
  `server.mjs`.

## 5. The same-user boundary (accepted residual risk)

The 600/700 permissions exclude **other OS users**. They do nothing
against processes running as the **same** OS user, and neither does
the loopback bind. Any same-user process can:

1. Read `~/.config/opencode-pocket/opencode-server-password`
   directly (it is the file's owner).
2. Read the same value from the environment of the running OpenCode
   or DevMoter processes via `/proc/<pid>/environ`.
3. Connect to `127.0.0.1:49374` directly and use the credential.

Test 2 in `test/opencode-upstream-boundary.test.mjs` demonstrates
exactly this: a standalone child process that reads the credential
file and calls the upstream gets full access without any DevMoter
code being involved; with a wrong credential it is refused.

Consequence, stated plainly: **a same-user process that goes direct
to the upstream bypasses every control DevMoter's proxy enforces** —
agent-mode/read-only restrictions (`server/agent-mode-policy.mjs`),
adapter-owned route mediation, sandbox policy checks, and secret
redaction. Those controls bind clients that come through DevMoter;
they do not bind the upstream. Protecting a constraint against a
same-user attacker would require the constraint to be enforced by
OpenCode itself or by an OS boundary (see §7), which is not the
current design.

What still holds despite this:

- Other OS users are excluded: credential files are 600 in a 700
  directory, and the upstream is loopback-only, so there is no
  network exposure of the upstream port.
- The credential is a 256-bit random token — not guessable, not
  derived from anything user-chosen.
- Remote access to DevMoter itself remains Tailscale-only with its
  own separate authentication; the upstream password is never a
  remote credential.
- Without the credential, direct access is refused (test 2): the
  boundary fails only for actors who already run code as the owner —
  the same trust level as the owner's own shell.

## 6. Verification

`test/opencode-upstream-boundary.test.mjs` (throwaway secrets, temp
dirs, loopback only, deterministic):

1. Runs the real bootstrap block extracted from
   `scripts/start-pocket.sh` against a temp `HOME` under umask 022:
   asserts directory mode 700, both password files mode 600, long
   independent tokens, and identical contents after a second run
   (create-once, no rotation). A second case pre-creates both files
   at mode 644 and asserts the bootstrap repairs them to 600 without
   changing their contents (self-heal). Also asserts the static
   chmod/umask contract in both launcher scripts, including the
   umask-before-creation and restore-after-both-secrets ordering in
   `scripts/systemd-entrypoint.sh` as well as in
   `scripts/start-pocket.sh`.
2. Spawns a separate Node process that reads the credential file and
   calls an auth-checking mock upstream directly: 200 with the real
   credential, 401 with a wrong one, 401 with none (§5).
3. Drives the real `createOpenCodeClient` with a header builder
   mirroring `server.mjs` `openCodeHeaders()`: the configured
   credential is accepted; a wrong or absent credential makes calls
   reject with status 401 (§4).

## 7. Future work (explicitly NOT implemented)

The issue names stronger separations. None of them are implemented
here; this note only records them so the residual risk in §5 is a
conscious, tracked acceptance rather than an unnoticed gap:

- Run OpenCode under a separate UID so file permissions and process
  boundaries actually separate it from other same-user processes.
- Serve the upstream on a Unix socket with peer-credential
  (`SO_PEERCRED`) checks instead of a loopback TCP port.
- Hand the credential to OpenCode/DevMoter over an inherited file
  descriptor instead of a file on disk and a process environment
  variable (both of which are same-user readable).

Until one of those lands, the security documentation must keep
treating "arbitrary code execution as the owner user" as equivalent
to "full upstream access" — because, per §5, it is.
