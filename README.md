# rust-math-engine

DevMoter Calc Engine — a Rust spreadsheet formula engine evaluating an
Excel-style formula subset, with WASM bindings for DevMoter Office.

- **Scope:** the **100 functions** declared in `docs/FUNCTION_PLAN_V2.md`
  (aggregates, logicals, math, text, lookups, date/time, statistics,
  dynamic arrays, and `LET`/`LAMBDA`/`MAP`/`REDUCE`), all implemented.
  Full Excel compatibility is an explicit non-goal; per-function
  semantics are documented in `docs/functions/`.
- **Engine:** incremental (differential) recalculation over a static
  dependency graph — editing a cell re-evaluates only its transitive
  dependents plus volatile cells (`RAND`, `RANDBETWEEN`, `TODAY`,
  `NOW`), with cycle detection (`#CIRC!`) and dynamic-array spilling
  (`#SPILL!`).
- **Priorities:** correctness, file preservation, declared compatibility,
  incremental recalculation, performance, AI integration — in that order.
- **Non-goals:** VBA/macros, pivot tables, chart rendering, Power Query,
  external workbook references, iterative calculation, network access.

## Layout

- `crates/calc-core` — values, lexer/parser/AST, workbook, dependency
  graph, evaluator, `CalcEngine` (std-only, no external dependencies)
- `crates/calc-functions` — the 100 standard functions, one file per
  function under `src/<category>/`, plus shared `common/` helpers and
  the `default_registry()` composition point
- `crates/calc-cli` — development CLI for evaluating formulas
- `crates/calc-wasm` — wasm-bindgen boundary (batch API)
- `tests/fixtures` — golden compatibility fixtures (FORMAT.md format)
- `docs/IMPLEMENTATION_PLAN.md`, `docs/FUNCTION_PLAN_V2.md` — the plans;
  `docs/adr/` — design decisions; `docs/SPEC-OPEN.md` — open
  Excel-compat questions

## Testing

```sh
cargo test --workspace            # full suite: unit, engine, golden fixtures
```

Golden fixtures live in `tests/fixtures/golden-*.json` and are exercised
by the `golden_*` harnesses under `crates/*/tests/`. Validate fixture
files after editing:

```sh
python3 tests/fixtures/validate.py tests/fixtures
```

## Benchmarks

```sh
cargo bench -p calc-core          # parse_bench + recalc_bench + scaffold
```

`recalc_bench` covers the plan §11 scenarios (initial calc, single-cell
change, 1% change, full change) on chain/wide dependency shapes.

## Example and CLI

```sh
cargo run -p calc-core --example end_to_end   # spill + LAMBDA + lookup demo
cargo run -p calc-cli -- eval "=SUM(1,2,3)"   # evaluate a formula
```

## License

MIT — see `LICENSE-MIT`. The plan's candidate is `MIT OR Apache-2.0`
and crate metadata still says so, but only the MIT text is vendored:
adding the Apache-2.0 text is pending a maintainer decision
(dependency-license audit, plan §17).
