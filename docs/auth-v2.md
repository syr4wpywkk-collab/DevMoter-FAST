# DevMoter owner sign-in (Auth v2)

DevMoter has one host owner and one shared owner session. GitHub, Google, Microsoft, passkeys, and local recovery are credentials for that owner; APIs do not grant different authority based on which credential created the session. Passkeys can sign in directly. Normally any linked method completes sign-in. With `DEVMOTER_PASSKEY_REQUIRED=1`, password/OAuth sign-in requires an additional Passkey check when a passkey exists; a direct Passkey sign-in already satisfies that requirement. This flag requires verified Passkey authentication, rather than enforcing two independent factors for every login.

The owner registry at `~/.config/opencode-pocket/auth-identities.json` stores the owner's random ID and verified provider identities. Version 1 GitHub bindings migrate to version 2 without changing the binding. A provider identity is matched by its verified subject (and issuer/tenant where applicable), never by a changeable email address. OAuth access and refresh tokens are used only to complete identity verification and are discarded; they are not stored. A new provider can be linked only by an already authenticated owner through Account settings. An unbound account attempting ordinary sign-in is rejected and cannot silently claim or link the owner.

Owner sessions are stored in `~/.config/opencode-pocket/auth-sessions.json`. The browser receives a random HttpOnly cookie token; the registry contains its SHA-256 hash, owner, provider metadata, host, and timestamps, never the raw token. The config directory and registry are owner-only, and registry writes use atomic replacement. Sessions are host-bound, expire, and are capped at 32; logout and session revocation remove their records. Corrupt or unsafe registries fail closed. `DEVMOTER_AUTH_SESSION_TTL_DAYS` defaults to 30 and accepts 1–90 days. Existing in-memory sessions cannot be recovered after the first upgrade/restart because their token hashes were never persisted; those browsers must sign in once again. Sessions created by Auth v2 survive later service restarts until expiry or revocation.

Passkeys remain scoped to the browser origin's WebAuthn RP ID. Owner sign-in and trusted-device authorization are separate: signing in identifies the host owner, while the existing trusted-device flow controls its own device authorization checks. Neither OAuth nor owner sign-in broadens API scopes or bypasses same-origin mutation checks, project boundaries, approvals, or terminal/device security boundaries. Basic authentication remains available for existing CLI/API clients.

Run one DevMoter service process per config directory. Auth registry mutations and verification counters are serialized within that process, including separate store instances. Sharing these files between concurrent service processes or network hosts is not supported; use separate config directories for separate installations.

## Google and Microsoft setup

Register each OAuth application with the exact callback URL for the origin used to open DevMoter. Set `DEVMOTER_PUBLIC_ORIGIN` to that same canonical origin (scheme, host, and optional port, with no path), especially behind Tailscale Serve or another reverse proxy. The callback is derived from this configured public origin, not an arbitrary request `Host` or forwarded header. Remote sign-in requires HTTPS. HTTP is supported only for loopback development (`localhost` / `127.0.0.1`). Do not use a public tunnel or expose this single-owner service directly to the internet.

Google OAuth client setup:

1. In Google Cloud Console, create or select a project and configure the OAuth consent screen for the intended audience.
2. Create an OAuth client ID of type **Web application**.
3. Add the exact authorized redirect URI `https://YOUR-DEV-MOTER-HOST/api/auth/google/callback` (replace the example with the real hostname). For local-only testing, use `http://localhost:8787/api/auth/google/callback`.
4. Configure `DEVMOTER_GOOGLE_CLIENT_ID` and `DEVMOTER_GOOGLE_CLIENT_SECRET` on the service host. Sign-in requests only `openid profile email`; no Google Drive permission is needed.

Microsoft identity platform setup:

1. In Microsoft Entra admin center, register an application. Choose **Accounts in any organizational directory and personal Microsoft accounts** to support both work/school and personal accounts, or select a narrower account type if that is your policy.
2. Add a **Web** platform redirect URI exactly matching `https://YOUR-DEV-MOTER-HOST/api/auth/microsoft/callback` (replace the example with the real hostname). For local-only testing, use `http://localhost:8787/api/auth/microsoft/callback`.
3. Create a client secret and configure `DEVMOTER_MICROSOFT_CLIENT_ID`, `DEVMOTER_MICROSOFT_CLIENT_SECRET`, and optionally `DEVMOTER_MICROSOFT_TENANT`. The tenant defaults to `common`; set a tenant ID or supported tenant selector to restrict the authority. Sign-in uses OpenID Connect identity scopes only and does not request Microsoft Graph or OneDrive access.

Both integrations use Authorization Code with PKCE, a short-lived one-time state, and OIDC issuer/audience/nonce validation. The verified subject is the account key; email is display metadata only. The client secret stays on the service host. Do not paste OAuth authorization codes, provider tokens, or secrets into logs, issues, or the browser.

## Configure the systemd user service

Keep provider secrets in a private environment file outside the checkout. For the default config directory:

```bash
install -d -m 700 "$HOME/.config/opencode-pocket"
install -m 600 /dev/null "$HOME/.config/opencode-pocket/oauth.env"
${EDITOR:-vi} "$HOME/.config/opencode-pocket/oauth.env"
```

Use ordinary systemd assignments in that file, for example:

```ini
DEVMOTER_PUBLIC_ORIGIN=https://YOUR-DEV-MOTER-HOST
DEVMOTER_GOOGLE_CLIENT_ID=...
DEVMOTER_GOOGLE_CLIENT_SECRET=...
DEVMOTER_MICROSOFT_CLIENT_ID=...
DEVMOTER_MICROSOFT_CLIENT_SECRET=...
DEVMOTER_MICROSOFT_TENANT=common
DEVMOTER_AUTH_SESSION_TTL_DAYS=30
```

Attach the file using a user-service drop-in:

```bash
systemctl --user edit devmoter-fast.service
```

Add:

```ini
[Service]
EnvironmentFile=%h/.config/opencode-pocket/oauth.env
```

Then apply and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart devmoter-fast.service
systemctl --user status devmoter-fast.service --no-pager -l
```

Do not commit `oauth.env` or place secrets in the unit file. Use confidential web application credentials for these server-side callbacks. OAuth credentials are not included in DevMoter and must be supplied by the operator; no real provider credentials are checked into the repository.

For passkey registration and the optional step-up mode, see [Remote-control security](./remote-control-security.md). In Auth v2, register a passkey after owner sign-in; legacy bootstrap settings do not bypass that requirement.
