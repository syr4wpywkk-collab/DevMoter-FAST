//! Parser benchmarks for the "initial parse" scenario of
//! `docs/IMPLEMENTATION_PLAN.md` section 11.
//!
//! Workloads cover the four parse-side shapes called out in the plan:
//! a small formula, a 100-term sum, deeply nested function calls, and
//! long range references. All inputs stay well under the parser's
//! enforced limits (MAX_DEPTH = 256, MAX_AST_NODES = 10_000,
//! MAX_FORMULA_LEN = 64 KiB) so the benchmarks measure real work, not
//! limit rejection.

use calc_core::parse;
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use std::hint::black_box;

/// Small, representative formula.
fn small_formula() -> String {
    "=SUM(A1:A10)*2+IF(B1>0,B1,-B1)".to_string()
}

/// `=A1+A2+...+A100` — wide, flat expression.
fn hundred_term_sum() -> String {
    let terms: Vec<String> = (1..=100).map(|i| format!("A{i}")).collect();
    format!("={}", terms.join("+"))
}

/// `=IF(TRUE,IF(TRUE,...1...))` with a nesting depth well under
/// MAX_DEPTH but large enough to stress the recursive-descent parser.
fn deeply_nested_calls() -> String {
    let depth = 128;
    let mut s = String::from("=");
    s.push_str(&"IF(TRUE,".repeat(depth));
    s.push('1');
    s.push_str(&")".repeat(depth));
    s
}

/// Full-range references with qualified sheet names.
fn long_range_references() -> String {
    "=SUM('Long Sheet Name 2026'!$A$1:$XFD$1048576)+SUM(Sheet2!AA100:ZZ999999)".to_string()
}

fn bench_parse(c: &mut Criterion) {
    let mut g = c.benchmark_group("parse");
    for (name, input) in [
        ("small_formula", small_formula()),
        ("hundred_term_sum", hundred_term_sum()),
        ("deeply_nested_calls", deeply_nested_calls()),
        ("long_range_references", long_range_references()),
    ] {
        g.bench_with_input(BenchmarkId::from_parameter(name), &input, |b, s| {
            b.iter(|| parse(black_box(s)));
        });
    }
    g.finish();
}

criterion_group!(benches, bench_parse);
criterion_main!(benches);
