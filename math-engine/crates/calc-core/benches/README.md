# Benchmarks for calc-core

criterion-based benchmarks for the formula engine. The engine itself is not
implemented yet; `eval_scaffold.rs` only proves the harness works and defines
where real benchmarks plug in.

## Layout

- `eval_scaffold.rs` — placeholder bench group. Real benches should be grouped
  per scenario below, one file per workload class as they land.
- `parse_bench.rs` — "Initial parse" scenario: small formula, 100-term sum,
  deeply nested calls, and long range references through `calc_core::parse`.
  Run alone with `cargo bench -p calc-core --bench parse_bench`.

## Scenario list (docs/IMPLEMENTATION_PLAN.md §11)

Workload sizes: 1k / 10k / 100k / 1M cells, with fixed input distribution and
dependency-graph density.

| Scenario                    | What it measures                                   |
|-----------------------------|----------------------------------------------------|
| Initial parse               | First parse of all formulas in the workbook        |
| Initial calculation         | First full recalculation                           |
| Single-cell change          | Incremental recalc after editing one cell          |
| 1% change                   | Incremental recalc after editing 1% of cells       |
| Full change                 | Recalc after touching every cell                   |
| SORT first run              | Sort of a fresh range                              |
| SORT differential           | Re-sort after a small change (PR 09 optimization)  |
| FILTER / UNIQUE             | Dynamic-array spill workloads                      |
| WASM startup                | Module instantiation + first call (runs elsewhere) |
| Memory peak                 | RSS / WASM linear memory at each workload size     |

## Metrics to report (§11)

- p50 / p95 latency, cells/sec
- RSS, WASM linear memory
- GC / boundary cost (WASM), build size

Numeric targets are set only after baseline measurement. CI x86-64 numbers
must not be conflated with ARM64 Chromebook measurements, which are a
separate real-device target.

## Running

```sh
cargo bench -p calc-core
```

Results go to `target/criterion/`.
