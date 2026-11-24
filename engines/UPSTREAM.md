# Vendored engine provenance

Each directory under `engines/` is an unmodified copy of one upstream commit. The pins live in [`manifest.json`](manifest.json); this table mirrors it.

| Directory | Upstream | Branch | Commit | Commit date (UTC) | Upstream version | License file |
|---|---|---|---|---|---|---|
| `engines/postgresql` | https://github.com/postgres/postgres | `master` | `19db7e5b36e33c80a032e0e811176ad3b115b0ca` | 2026-11-23 12:17 | 20devel | `COPYRIGHT` |
| `engines/sqlite` | https://github.com/sqlite/sqlite | `master` | `ebe179657df19e3b1c88f129cf6237400066c821` | 2026-11-23 16:34 | 3.55.0 | `LICENSE.md` |
| `engines/duckdb` | https://github.com/duckdb/duckdb | `main` | `1f21520ea1e43348df41cd69ce6811a942415972` | 2026-11-23 15:15 | main (unreleased) | `LICENSE` |
| `engines/valkey` | https://github.com/valkey-io/valkey | `unstable` | `28ef86b44342797ba1512b623b279287eaf979ba` | 2026-11-23 02:33 | unstable (255.255.255) | `COPYING` |

All four pins are development-branch commits, not release tags. Moving to release tags is an upstream update and follows the update policy below.

## How the pins are verified

`manifest.json` records, for each engine, the upstream commit and that commit's git tree id. A git tree id is a hash over every file's name, mode and content, so two equal tree ids mean byte-identical source.

```sh
npm run upstream:verify              # vendored tree at HEAD == pinned tree, no uncommitted changes
npm run upstream:verify -- --online  # also: the commit exists upstream, has that tree, and is on the pinned branch
```

CI runs the `--online` form on every pull request. Any edit under `engines/` changes the tree id and fails the check, which is what keeps the engines unmodified.

## History of the initial import

The initial import (commit `e70f7820`) used GitHub zipballs of the default branches without recording a commit or checksum. The revisions above were established afterwards by comparing every file against upstream:

- `engines/sqlite` matched upstream exactly.
- `engines/postgresql`, `engines/duckdb` and `engines/valkey` matched in every file they contained, but were missing 1, 56 and 5 files that upstream tracks despite its own `.gitignore` rules (for example `deps/jemalloc/configure` in Valkey and binary test fixtures in DuckDB). Those files were restored from the pinned commits, after which all four tree ids equal upstream.

Because some upstream-tracked files match upstream `.gitignore` patterns, add engine files with `git add -f` when updating.

## Update policy

1. Select an explicit upstream release tag or commit and record its full commit SHA.
2. Replace the engine directory with exactly that commit's tree (`git add -f` so ignored-but-tracked files are kept), then update `manifest.json` and the table above.
3. Run `npm run upstream:verify -- --online`.
4. Review changes and preserve upstream license and notice files.
5. Run secret scanning, dependency/license review, supported-platform builds and tests.
6. Open a separate reviewable PR. Do not auto-merge upstream code.

**Scope note:** Vendoring source does not imply any engine is built, configured, exposed as a service, or safe for production. See `docs/audits/initial-import-audit.md`.
