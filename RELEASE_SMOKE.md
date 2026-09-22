# Release smoke checklist

Run this checklist before every tagged DevMoter release. Automated CI is necessary, but it does not replace the real Chromebook/Crostini + iPhone path.

## Automated gate

- [ ] `npm ci`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] CI is green on the release commit

The integration suite uses mocked OpenCode and Codex backends, so ordinary CI does not require real external accounts.

## Chromebook / Crostini host

- [ ] Start DevMoter using the documented launcher/service.
- [ ] Confirm DevMoter binds to localhost by default.
- [ ] Confirm OpenCode is not exposed directly.
- [ ] Confirm `/api/health` reports the expected backend state.
- [ ] If using Tailscale Serve, confirm the private HTTPS URL points only at DevMoter.

## iPhone / mobile browser

- [ ] Open the DevMoter URL.
- [ ] Authenticate when DevMoter-native authentication is enabled.
- [ ] Select a project.
- [ ] Select a model/agent as applicable.
- [ ] Create or resume one OpenCode session.
- [ ] Send a prompt and verify streamed output.
- [ ] Interrupt an active run and confirm the UI returns to a stable state.
- [ ] Reload during/after a run and confirm session state reconciles.
- [ ] Create or resume one Codex thread.
- [ ] Send a prompt and verify streamed output.
- [ ] Exercise an approval/question flow when available.
- [ ] Confirm long tool/log output remains scrollable and copyable.
- [ ] Confirm GitHub Projects can open an already-managed repository without discarding local work.

## Failure-path checks

- [ ] Stop one backend and confirm the other surface remains understandable/usable.
- [ ] Restore the backend and confirm reconnect/reconciliation works.
- [ ] Simulate a network interruption during a mutation and confirm DevMoter does not blindly resend it.
- [ ] Confirm unauthenticated API/SSE requests are rejected once #10 is present on the release branch.

Record the device/browser versions and release commit in the release notes.
