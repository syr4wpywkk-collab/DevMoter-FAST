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

| Target          | Entry point                           | Status      |
|-----------------|---------------------------------------|-------------|
| `parser_fuzz`   | `calc_core::parse`                    | live        |

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

- Seed corpus lives in `fuzz/corpus/<target>/` and is committed.
- `parser_fuzz` seeds come from two sources:
  - `gen-*.txt`, ... — every distinct `formula` string in
    `tests/fixtures/golden-phase1.json`, one file per case named after
    the case id. These are the compatibility-relevant inputs and should
    be regenerated when the fixture grows.
  - `adv-*.txt` — hand-written adversarial seeds probing the §10.4
    limits and lexer edge cases: deep paren/function nesting, huge
    numeric literals, unterminated strings, stray/trailing operators,
    comma spam, max-size range references, and long sheet names.
- Commit interesting new seeds (invalid syntax, limit-boundary inputs,
  compatibility fixtures reduced to minimal form); do not commit large
  generated corpora produced by long fuzz runs.
- Reproductions of past crashes go into `tests/fixtures/` as regression cases.
