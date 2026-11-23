# Fuzzing (cargo-fuzz)

libFuzzer targets for the calc engine. `fuzz/` is intentionally **not** a
workspace member (cargo-fuzz requires its own crate; it is listed in the
root workspace `exclude`).

## Setup

```sh
cargo install cargo-fuzz
rustup component add --toolchain nightly llvm-tools  # if needed
cd fuzz
cargo +nightly fuzz run parser_fuzz
```

## Targets

| Target          | Entry point (once implemented)        | Status      |
|-----------------|---------------------------------------|-------------|
| `parser_fuzz`   | `calc_core::parse`                    | pass-through stub |

## Input limits (docs/IMPLEMENTATION_PLAN.md §10.4)

The engine must enforce these configurable limits; fuzz inputs are shaped to
probe them:

- formula length ≤ 64 KiB
- AST nodes ≤ 10,000
- recursion depth ≤ 256
- evaluation steps ≤ 1,000,000
- dynamic arrays ≤ 1,000,000 cells

Fuzz inputs cover: arbitrary UTF-8, huge parenthesis runs, deep nesting, long
sheet names, huge ranges, and circular references. A crash, panic, infinite
loop, memory exhaustion, or exponential expansion is a bug — file it per
`SECURITY.md`.

## Corpus policy

- Seed corpus lives in `fuzz/corpus/<target>/` (created on first run).
- Commit interesting seeds (invalid syntax, limit-boundary inputs,
  compatibility fixtures reduced to minimal form); do not commit large
  generated corpora.
- Reproductions of past crashes go into `tests/fixtures/` as regression cases.
