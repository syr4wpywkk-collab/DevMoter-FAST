# Optional E2EE relay: threat model and protocol design

Status: **design only**. This document intentionally does not ship a relay implementation. Direct private access (for example, Tailscale Serve to a localhost-bound DevMoter instance) remains the default and simplest path.

## Goals

An optional relay may help a user reach a DevMoter host when a direct private route is unavailable. The relay must be transport infrastructure, not a credential broker.

The design must ensure that:

- reusable Codex/OpenCode/provider credentials never leave the DevMoter host;
- relay operators cannot read agent prompts, responses, approvals, project paths, or uploaded-file contents;
- every device is explicitly paired and individually revocable;
- compromised or revoked devices cannot silently regain access;
- encryption keys rotate and are not long-lived bearer credentials;
- relay metadata leakage is documented rather than hidden behind an "E2EE" label.

## Non-goals

The relay is not a public multi-user DevMoter service, an account-sharing feature, a way to bypass upstream authentication, or a replacement for host-side approval/permission policy.

The relay must not auto-approve Codex/OpenCode operations. Existing host-side approval and permission boundaries remain authoritative.

## Threat model

Assume an attacker may control or observe any of the following without controlling the DevMoter host itself:

- the relay service and its storage;
- the network between device, relay, and host;
- a previously paired device that has been lost or compromised;
- a malicious newly paired device if the user approves the wrong pairing;
- captured/replayed relay frames;
- metadata such as timing, IP addresses, connection duration, and ciphertext sizes.

If the DevMoter host itself is compromised, the relay cannot protect host-resident projects or backend credentials.

## Device identity and pairing

Each DevMoter host has a host identity key. Each client device generates its own device identity key locally.

Pairing is explicit and short-lived:

1. The trusted host creates a one-time pairing offer with an expiry.
2. The offer contains only a relay namespace, the host's public identity material, an ephemeral pairing public key, and a short-lived nonce/code.
3. The user confirms the pairing on the trusted host/device.
4. Both sides derive a fresh encrypted session using a reviewed standard authenticated key-exchange protocol (for example, a Noise-family handshake or an equivalent audited construction).
5. The host records the new device public identity and a human-readable device label.

A QR code may encode the pairing offer, but it must never contain reusable backend credentials, SSH private keys, provider API keys, Codex/OpenCode login material, or a long-lived relay bearer token.

## Encryption and key rotation

Do not invent a custom cipher or handshake.

The implementation should use a maintained cryptographic library and an authenticated key-exchange protocol with forward-secret ephemeral session keys. Application messages are encrypted end-to-end between the paired device and DevMoter host; the relay forwards opaque ciphertext.

Session keys rotate:

- after every reconnect/handshake;
- on a bounded time interval;
- after a bounded number of encrypted frames;
- immediately after device revocation or host key rotation.

Long-lived device identity keys are used to authenticate handshakes, not to encrypt application traffic directly.

## Relay-visible metadata

Even with E2EE, a relay can observe metadata such as:

- source/destination IP addresses;
- connection timing and duration;
- device/host routing identifiers;
- ciphertext sizes and traffic volume;
- reconnect and availability patterns.

The initial implementation should minimize stable identifiers and avoid logging payload-derived metadata. Optional padding/batching can be considered later, but the UI/documentation must not claim that ordinary E2EE hides traffic metadata.

## Revocation

The host maintains the authoritative paired-device allowlist.

Revoking a device:

1. removes the device identity from the allowlist;
2. closes live sessions for that device;
3. advances a host authorization epoch so cached session material is no longer accepted;
4. requires a completely new explicit pairing before the device can return.

Relay-side deletion is best-effort cleanup, not the security boundary.

## Authentication and authorization

Relay encryption is not authorization by itself. After the secure channel is established, requests still pass through DevMoter authentication plus the same API, project, approval, and permission checks as direct requests.

The relay never receives reusable backend credentials. Backend calls are performed only by the host-side DevMoter process.

## Replay and ordering

Every encrypted application frame includes a session identifier and monotonic sequence number authenticated as associated data. Duplicate, stale, or out-of-window frames are rejected.

State-changing DevMoter requests continue to use operation IDs/idempotency handling so reconnect/replay cannot silently duplicate mutations.

## Availability and abuse limits

The relay and host connector must apply bounded message size, connection, concurrency, and rate limits. A malicious relay may drop or delay traffic; E2EE provides confidentiality/integrity, not guaranteed availability.

## Review gates before implementation

No relay implementation should ship until all of these are complete:

- protocol review by someone other than the author;
- concrete cryptographic library/protocol selection;
- protocol state-machine tests and published test vectors;
- replay, downgrade, revocation, reconnect, and key-rotation tests;
- payload-size/rate/concurrency limits;
- explicit metadata-leakage documentation;
- verification that direct Tailscale/private-network mode stays the default.

This document satisfies the design/review prerequisite only; it does not authorize shipping relay code.
