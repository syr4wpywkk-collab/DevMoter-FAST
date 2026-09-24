# Host Secret Vault — API Foundation

This MAR-13 slice connects the encrypted, host-local secret store to a device-authenticated HTTP API. It is an API foundation, not yet the mobile Vault UI or provider integration.

## Storage and unlock contract

- The JSON envelope contains only a format version, scrypt salt, AES-256-GCM nonce/tag, and ciphertext. Secret values and environment-variable mappings are encrypted together.
- A user-chosen passphrase is required to initialize or unlock the store. Key derivation uses scrypt N=2^17, r=8, p=1 (128 MiB working memory) with a 256 MiB Node.js maxmem ceiling; choose a high-entropy passphrase rather than relying on the 12-byte minimum. The derived key exists only in server memory while unlocked; the passphrase is sent only in the authenticated request body and is not persisted or returned.
- The owner must retain the passphrase. There is no recovery or key escrow. A wrong passphrase, unsupported format, authentication-tag failure, symlink, or group/world-readable store fails closed.
- The vault file is atomically replaced with mode `0600`; its parent directory is created with mode `0700`. This assumes a trusted local account and a filesystem honoring owner-only modes. Same-user malware and an already-compromised running DevMoter process remain in scope as trusted authority.
- The default file is `~/.local/share/devmoter-fast/secrets/vault.json`. `secret://<provider>/<name>` is the host-side reference. `list()` returns metadata only; the internal `resolve()` method checks project and provider bindings and records last use.

## HTTP API and authorization

Every `/api/secrets` request requires normal DevMoter authentication and an active paired-device token. Mutations also pass the global exact-Origin gate and operation-ID deduplication before dispatch. The server validates each project ID against the registered project list before storing a binding.

| Method and route | Purpose |
|---|---|
| `GET /api/secrets/status` | Report initialized/unlocked state and count. |
| `POST /api/secrets/initialize` | Initialize an empty vault using a passphrase. Existing vaults cannot be overwritten. |
| `POST /api/secrets/unlock` | Unlock using the passphrase. Failed attempts are limited to five per trusted device per ten-minute window in the current server process. |
| `POST /api/secrets/lock` | Clear the in-memory key and values. Restart also returns the vault to locked state. |
| `GET /api/secrets` | Return masked metadata only; no secret values. |
| `PUT /api/secrets` | Add a secret bound to one or more registered projects. Replacing an existing reference requires `confirmReplace: true`. |
| `DELETE /api/secrets/:provider/:name` | Delete only when the JSON body includes the exact `confirmReference` for the target. |

There is deliberately no HTTP reveal, copy, or resolve route. A secret value is accepted on create/replace but is never returned by this API. Provider/Agent injection is not enabled by this API slice.

## Security boundary and limitations

The encryption key is derived from a passphrase entered during explicit unlock rather than stored beside ciphertext. When locked, the API exposes no secret values. The API remains separate from `llm-providers.json`; existing API Chat provider keys continue to use the previous server-side storage path. There is no mobile Vault UI, provider/Agent injection, fresh-authentication/reveal flow, comprehensive audit trail, or end-to-end log/context redaction yet. Unlock rate limits are process-local and reset when the server restarts.

Never describe this slice as completing MAR-13 acceptance. In particular, API Chat/Agent/Browser Secret ID usage, provider migration, and end-to-end log/context redaction remain incomplete.
