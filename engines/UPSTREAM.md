# Vendored engine provenance

This repository contains ZIP snapshots fetched from the GitHub API using the default branch at download time. The original import did **not** pin a commit SHA or save the downloaded archive checksums. The precise upstream revisions therefore cannot be established from the import script alone.

| Directory | Source | Import method | Exact upstream revision |
|---|---|---|---|
| engines/postgresql | https://github.com/postgres/postgres | GitHub API zipball, default branch | Unknown — needs content-based verification |
| engines/sqlite | https://github.com/sqlite/sqlite | GitHub API zipball, default branch | Unknown — needs content-based verification |
| engines/duckdb | https://github.com/duckdb/duckdb | GitHub API zipball, default branch | Unknown — needs content-based verification |
| engines/valkey | https://github.com/valkey-io/valkey | GitHub API zipball, default branch | Unknown — needs content-based verification |

## Update policy

1. Select and record an explicit upstream release tag and full commit SHA.
2. Download from the pinned SHA, verify the archive, and record SHA-256 checksum and retrieval date.
3. Review changes and preserve upstream license and notice files.
4. Run secret scanning, dependency/license review, supported-platform builds and tests.
5. Open a separate reviewable PR. Do not auto-merge upstream code.

**Scope note:** Vendoring source does not imply any engine is built, configured, exposed as a service, or safe for production. See `docs/audits/initial-import-audit.md`.
