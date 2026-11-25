# Security Policy (Draft)

This document drafts the security posture for the DevMoter Calc Engine,
based on `docs/IMPLEMENTATION_PLAN.md` §10.4 and §15. It is a working draft
and will be finalized before the v1.0 release.

## Scope

The calculation core (`calc-core`) is a library that parses and evaluates
spreadsheet formula strings supplied by a host application. Untrusted input
therefore reaches the parser and evaluator directly.

## Trust boundaries and hard constraints

- **No network access**: the calculation core must not perform network I/O
  and is not granted network permissions. Dependencies introducing network
  capability into `calc-core` will be rejected.
- **No ambient authority**: formula strings are never passed to external
  commands, files, or HTTP endpoints. The engine does not execute host code
  from formulas.
- `calc-core` keeps external crate dependencies at zero (std only) to limit
  supply-chain surface; dev/tooling dependencies are kept separate.

## Input limits (initial values, configurable)

Per plan §10.4, the engine enforces configurable limits; initial values:

| Resource                | Limit       |
|-------------------------|-------------|
| Formula length          | 64 KiB      |
| AST nodes               | 10,000      |
| Recursion depth         | 256         |
| Evaluation steps        | 1,000,000   |
| Dynamic array size      | 1,000,000 cells |

Exceeding a limit must produce a regular error value/result, never a panic,
abort, or unbounded allocation. Evaluation is subject to a wall-clock/compute
budget and must support cancellation; each workbook carries a memory budget.
These values are tuned against real measurements and may change before v1.0.

## Fuzzing policy

- `fuzz/` contains cargo-fuzz (libFuzzer) targets; see `fuzz/README.md`.
- Coverage includes arbitrary UTF-8, deep nesting, huge parenthesis runs,
  long sheet names, huge ranges, and circular references.
- Panics, infinite loops, memory exhaustion, and exponential input expansion
  are treated as security-relevant bugs.
- Crash reproductions are added to `tests/fixtures/` as regression cases.

## Dependency and release policy

- Dependency additions require SPDX license review (§15: OSS license risk).
- Release gates (§13) include `cargo fmt`, `clippy -D warnings`, the full
  test suite, dependency audit, and license audit.
- Known limitations ship in release notes; "CI green" alone is never claimed
  as Excel compatibility or security assurance.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Report suspected vulnerabilities privately to the maintainers via GitHub's
private vulnerability reporting ("Report a vulnerability" on the repository's
Security tab), or by contacting the repository maintainers listed in the
project README.

Please include: affected version/commit, input or steps to reproduce,
observed behavior (panic, hang, memory growth, incorrect result with security
impact), and environment (platform, toolchain, WASM vs native).

We will acknowledge reports as soon as we can, investigate, and coordinate
disclosure with the reporter. Fixes for security-relevant bugs are
prioritized over feature work.
