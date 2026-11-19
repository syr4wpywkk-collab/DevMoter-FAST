# Module dependency graph (#356)

Generated on 2026-11-20 from `main` with `npm run deps:graph -- --top 12`. Regenerate it after large refactors. Only relative imports in `src/`, `server/` and `server.mjs` are counted; locales are excluded.

177 modules, 342 relative imports

| Module | Imported by | Imports |
|---|---|---|
| `src/i18n.ts` | 33 | 1 |
| `server/error-message.mjs` | 17 | 0 |
| `server/safe-file.mjs` | 12 | 0 |
| `src/sheet-header.mjs` | 11 | 1 |
| `src/i18n-core.mjs` | 10 | 0 |
| `server/setup/detector.mjs` | 9 | 1 |
| `server/auth.mjs` | 8 | 0 |
| `src/device-gate.mjs` | 7 | 1 |
| `src/app-registry.ts` | 6 | 0 |
| `src/chat-markdown.mjs` | 6 | 1 |
| `src/feature-flags.mjs` | 5 | 0 |
| `server/advanced-features.mjs` | 4 | 2 |

```mermaid
graph LR
  src_i18n_ts["src/i18n.ts"]
  server_error_message_mjs["server/error-message.mjs"]
  server_safe_file_mjs["server/safe-file.mjs"]
  src_sheet_header_mjs["src/sheet-header.mjs"]
  src_i18n_core_mjs["src/i18n-core.mjs"]
  server_setup_detector_mjs["server/setup/detector.mjs"]
  server_auth_mjs["server/auth.mjs"]
  src_device_gate_mjs["src/device-gate.mjs"]
  src_app_registry_ts["src/app-registry.ts"]
  src_chat_markdown_mjs["src/chat-markdown.mjs"]
  src_feature_flags_mjs["src/feature-flags.mjs"]
  server_advanced_features_mjs["server/advanced-features.mjs"]
  src_chat_markdown_mjs --> src_i18n_core_mjs
  src_device_gate_mjs --> src_i18n_core_mjs
  src_i18n_ts --> src_i18n_core_mjs
  src_sheet_header_mjs --> src_i18n_core_mjs
  server_advanced_features_mjs --> server_error_message_mjs
  server_advanced_features_mjs --> server_safe_file_mjs
```
