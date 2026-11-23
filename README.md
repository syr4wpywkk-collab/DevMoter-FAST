# rust-math-engine

DevMoter Calc Engine — a Rust spreadsheet formula engine evaluating an
Excel-style formula subset, with WASM bindings for DevMoter Office.

- **Scope:** the 38 functions declared in `docs/IMPLEMENTATION_PLAN.md`
  (SUM/AVERAGE/IF/VLOOKUP-class lookups, dynamic arrays, statistics, dates).
  Full Excel compatibility is an explicit non-goal.
- **Priorities:** correctness, file preservation, declared compatibility,
  incremental recalculation, performance, AI integration — in that order.
- **Non-goals:** VBA/macros, pivot tables, chart rendering, Power Query,
  external workbook references, iterative calculation, network access.

## Layout

- `crates/calc-core` — values, formula parser, workbook, dependency graph, evaluator
- `crates/calc-cli` — development CLI for evaluation and compatibility checks
- `crates/calc-wasm` — wasm-bindgen boundary (batch API)
- `tests/fixtures` — golden compatibility fixtures with recorded provenance
- `docs/IMPLEMENTATION_PLAN.md` — the full implementation plan (v1.0)

## Status

Scaffold only (plan PR 00). No engine functionality yet.

## License

Intended: MIT OR Apache-2.0 (final decision pending dependency license
audit, see plan §17). MIT text is in `LICENSE-MIT`; the Apache-2.0 text is
added when the license is finalized.
