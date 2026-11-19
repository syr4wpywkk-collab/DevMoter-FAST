# Pre-release smoke test

Run this before tagging a release or updating a host. Every step is either a
repository command or a check against the running host; none of it changes
configuration.

## 1. Automated (any machine with the checkout)

```bash
npm ci
npm run typecheck
npm run lint
npm run build          # also needed by test/pwa-public-assets.test.mjs
npm test
npm run security:audit
npm audit --audit-level=high
```

All must pass. CI (`.github/workflows/ci.yml`, `security-audit.yml`, `codeql.yml`)
runs the same commands plus the WebKit browser suites
(`npm run test:workspace-browser`, `npm run test:opencode-navigation`).

## 2. Host service (target host)

```bash
systemctl --user restart devmoter-fast.service
systemctl --user status devmoter-fast.service --no-pager -l
curl -fsS http://127.0.0.1:8787/api/health
```

The unit must be `active (running)` and `/api/health` must answer. If it
restart-loops, read `journalctl --user -u devmoter-fast.service`; see
[operations.md](operations.md).

## 3. Browser (owner's device)

- [ ] `/login.html` loads without signing in; `/` redirects there when signed out.
- [ ] Sign in (Passkey, or recovery followed by the Passkey step-up).
- [ ] Home opens; the expected apps are listed.
- [ ] Open Codex and OpenCode; each shows online/offline status, history loads.
- [ ] Send one short prompt in a test project and receive a reply.
- [ ] Background the tab or toggle airplane mode, return: the chat reconnects.
- [ ] Settings → Diagnostics shows the host build and this device's build; they match.
- [ ] After an update, reload once: the service worker serves the new build.

Device-specific checks (iPhone/PWA, GitHub workspace) are in
[GITHUB_WORKSPACE_DEVICE_SMOKE.md](GITHUB_WORKSPACE_DEVICE_SMOKE.md) and must be
done on the real device.

## 4. Record

Note the commit, date, host, and any failed step in the release PR or issue.
A failed step blocks the release until it is fixed or explicitly accepted by the owner.
