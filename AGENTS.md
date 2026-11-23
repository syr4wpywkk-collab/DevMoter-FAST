# DevMoter Base: notes for coding agents

- `engines/` holds vendored upstream sources (PostgreSQL, SQLite, DuckDB, Valkey). Do not edit them; DevMoter Base code lives in `src/`, `scripts/`, `test/`.
- TypeScript runs directly on Node (>= 22.18, type stripping): no build step, erasable syntax only (no `enum`, no parameter properties), imports end in `.ts`.
- Checks: `npm run typecheck`, `npm test`, `npm run deps:check`, `npm run upstream:verify` (all four: `npm run check`).
- `engines/<name>` must stay byte-identical to the commit pinned in `engines/manifest.json`; `upstream:verify` fails on any edit. Some upstream-tracked files match upstream `.gitignore` rules, so use `git add -f` when updating an engine.
- Dependencies are pinned to exact versions; `npm run deps:check` enforces this plus the license allowlist.
- Root `.gitignore` patterns must stay anchored (`/name/`): unanchored ones also hide files inside `engines/`.
- Never log secrets; use the logger in `src/logging/` (it redacts), not `console.log`, in `src/`.
- Update the matching row in `docs/roadmap/features.md` when a feature is implemented or verified.
