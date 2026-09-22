# Threat model

This document describes the current DevMoter FAST trust boundaries. It is not a claim that the project is safe for public-Internet exposure.

## Assets

DevMoter must protect:

- local source repositories and files;
- agent credentials held by Codex/OpenCode/GitHub CLI;
- project paths and private repository metadata;
- approval/question state;
- uploaded attachments;
- the ability to execute commands or edit files through the underlying agents.

## Deployment assumption

The default server binds to `127.0.0.1`. Remote-phone access is expected to use a private transport such as Tailscale Serve.

Current `main` must still be treated as a private-host/private-network product. DevMoter-native authentication tracked by #10 is an additional application boundary; until that work is present on the release branch and verified, network reachability itself remains security-sensitive.

## Trust boundaries

1. **Browser ↔ DevMoter** — browser input is untrusted. Paths, operation IDs, JSON bodies, project IDs, filenames, and method names require validation.
2. **DevMoter ↔ OpenCode** — OpenCode is trusted to perform the agent operations the user has enabled, but its credentials must not cross into the browser.
3. **DevMoter ↔ Codex app-server** — the app-server is a privileged local process. DevMoter restricts the browser to an RPC allowlist and validates approval responses.
4. **DevMoter ↔ filesystem** — project content is data, not trusted instructions to the server. Path containment must be enforced server-side.
5. **DevMoter ↔ GitHub CLI** — the host `gh` session is privileged. Tokens stay in the host process environment/configuration; browser input never selects an arbitrary executable, URL, or clone destination.

## Attacker models

### Same LAN or reachable private network peer

If that peer can reach a DevMoter deployment without a verified application-auth boundary, they may be able to control privileged agents. Bind locally and expose only through an intentionally configured private layer.

### Same Tailnet peer

Tailnet membership alone should not be confused with least privilege. Device/account ACLs and DevMoter-native authentication should be treated as separate controls.

### Malicious browser request / CSRF-like request

Mutation endpoints must validate origin/authentication when that layer is enabled, validate request bodies, and use operation IDs so ambiguous network failures are not blindly replayed.

### Hostile filename or path

Reject traversal, absolute-path escapes, unexpected extensions, arbitrary clone destinations, and unsafe symlink/real-path escapes. Never trust a browser-provided raw working-directory header.

### Compromised project content

Repository files can contain misleading text, malicious scripts, or instructions intended for an agent. DevMoter's path restrictions do not sandbox the underlying coding agent. Agent permissions and approval policy remain a separate boundary.

## Important controls

- localhost-first bind;
- server-side OpenCode and GitHub credentials;
- Codex RPC allowlist;
- Project-ID to server-side path resolution;
- Markdown-only mobile writes;
- upload size/name controls;
- managed GitHub clone root and origin verification;
- no automatic reset/rebase/stash/force checkout;
- bounded duplicate-mutation registry;
- no automatic retry of ambiguous writes.

## Non-goals

DevMoter is not currently:

- a hostile multi-tenant SaaS isolation boundary;
- a sandbox for arbitrary untrusted code;
- a replacement for OS user permissions;
- a guarantee that an enabled coding agent cannot modify files outside the narrow browser editor;
- an authorization layer for sharing one host among mutually untrusted users.

## Residual risks

- a reachable unauthenticated release can expose powerful agent controls;
- upstream Codex/OpenCode protocol changes can invalidate assumptions;
- an agent may have broader filesystem/shell permissions than the DevMoter browser editor;
- uploaded data and local logs require lifecycle/retention discipline;
- mobile reconnect and backgrounding behavior varies by browser and needs real-device release testing.

Security changes should update this document when a trust boundary or assumption changes.
