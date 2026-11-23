//! Benchmark scaffold for the future formula-evaluation pipeline.
//!
//! The parser/evaluator does not exist yet, so this file only wires up
//! criterion and provides a placeholder benchmark that exercises a fixed
//! formula input end-to-end once `calc-core` exposes `parse`/`evaluate`.
//! See `benches/README.md` for the scenario list from
//! `docs/IMPLEMENTATION_PLAN.md` section 11.

use criterion::{Criterion, criterion_group, criterion_main};
use std::hint::black_box;

/// Representative formula input used by the placeholder benchmark.
/// Sizes mirror the workload classes in plan section 11 (1k..1M cells);
/// concrete cell counts are fixed here once the workbook API lands.
const SAMPLE_FORMULA: &str = "=SUM(A1:A1000)+XLOOKUP(B1,C1:C1000,D1:D1000)";

/// Placeholder: proves the bench harness runs and gives a stable baseline
/// for input handling. Replace with `parse(SAMPLE_FORMULA)` /
/// `workbook.recalculate()` when those APIs exist.
fn bench_eval_scaffold(c: &mut Criterion) {
    c.bench_function("eval_scaffold/formula_input_handling", |b| {
        b.iter(|| black_box(SAMPLE_FORMULA).len())
    });
}

criterion_group!(benches, bench_eval_scaffold);
criterion_main!(benches);
