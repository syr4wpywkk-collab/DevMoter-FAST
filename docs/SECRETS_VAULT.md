# Host Secret Vault — Foundation

This MAR-13 foundation provides an encrypted, host-local secret store. It is a storage primitive, not yet the API Vault UI or provider integration.

## Storage and unlock contract

- The JSON envelope contains only a format version, scrypt salt, AES-256-GCM nonce/tag, and ciphertext. Secret values and environment-variable mappings are encrypted together.
- A user-chosen passphrase is required to initialize or unlock the store. The derived key exists only in server memory while unlocked; the passphrase is not persisted or sent to the browser by this module.
- The owner must retain the passphrase. There is no recovery or key escrow. A wrong passphrase, unsupported format, authentication-tag failure, symlink, or group/world-readable store fails closed.
- The vault file is atomically replaced with mode `0600`; its parent directory is created with mode `0700`. This assumes a trusted local account and a filesystem honoring owner-only modes. Same-user malware and an already-compromised running DevMoter process remain in scope as trusted authority.
- `secret://<provider>/<name>` is the host-side reference. `list()` returns metadata only; `resolve()` is a privileged host API and records last use. Project and provider bindings are checked before returning the value.

## Security boundary and limitations

The encryption key is derived from a passphrase entered during explicit host-side unlock rather than stored beside ciphertext. When locked, this module exposes no secret values. It does not yet replace `llm-providers.json`, add authenticated HTTP routes, provide a mobile unlock/re-auth/reveal flow, inject references into API Chat/Agents, or redact secret values from every backend stream. Those integrations need separate reviewable follow-up work; existing provider API keys continue to use the previous server-side storage path until migration is implemented.

Never describe this foundation as completing MAR-13 acceptance. In particular, API Chat/Agent/Browser Secret ID usage and end-to-end log/context redaction remain incomplete.
