//! Recalculation benchmarks for the "initial calculation", "single-cell
//! change", "1% change", and "full change" scenarios of
//! `docs/IMPLEMENTATION_PLAN.md` section 11.
//!
//! Two dependency-graph shapes from the plan's workload list:
//!
//! - *chain*: `B_i = B_{i-1} + 1` — one changed cell dirties the whole
//!   downstream path, stressing dirty propagation and topological order.
//! - *wide*: `C_i = B_i * 2` with independent inputs — one changed cell
//!   dirties a single formula, isolating the cost of the
//!   dependents-of lookup itself.
//!
//! Sizes use the plan's 1k / 10k classes (100k+ workloads would need the
//! release-profile budgets of the real-device runs, not CI benches).

use calc_core::{CalcEngine, CellInput, Value};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use std::hint::black_box;

fn engine() -> CalcEngine {
    let mut e = CalcEngine::new();
    e.set_registry(Box::new(calc_functions::default_registry()));
    e.add_sheet("Sheet1").unwrap();
    e
}

fn set_num(e: &mut CalcEngine, addr: &str, n: f64) {
    e.set_cell("Sheet1", addr, CellInput::Value(Value::Number(n)))
        .unwrap();
}

fn set(e: &mut CalcEngine, addr: &str, input: &str) {
    e.set_cell("Sheet1", addr, CellInput::from_typed(input))
        .unwrap();
}

/// `B1` = 0, `B_i = B_{i-1}+1` for i in 2..=n. A change at B1 dirties
/// all n-1 downstream cells.
fn chain_workbook(n: u32) -> CalcEngine {
    let mut e = engine();
    set_num(&mut e, "B1", 0.0);
    for i in 2..=n {
        set(&mut e, &format!("B{i}"), &format!("=B{}+1", i - 1));
    }
    e.recalculate().unwrap();
    e
}

/// `B_i` = i, `C_i = B_i * 2` for i in 1..=n — n independent edges.
/// Changing one `B_i` dirties exactly one formula.
fn wide_workbook(n: u32) -> CalcEngine {
    let mut e = engine();
    for i in 1..=n {
        set_num(&mut e, &format!("B{i}"), f64::from(i));
        set(&mut e, &format!("C{i}"), &format!("=B{i}*2"));
    }
    e.recalculate().unwrap();
    e
}

/// `D1 = SUM(B1:B{n})`: every input cell feeds one range dep. Changing
/// any `B_i` exercises the range-watcher path of dirty propagation.
fn range_workbook(n: u32) -> CalcEngine {
    let mut e = engine();
    for i in 1..=n {
        set_num(&mut e, &format!("B{i}"), f64::from(i));
    }
    set(&mut e, "D1", &format!("=SUM(B1:B{n})"));
    e.recalculate().unwrap();
    e
}

fn bench_initial_calc(c: &mut Criterion) {
    let mut g = c.benchmark_group("recalc/initial");
    for n in [1_000u32, 10_000] {
        g.bench_with_input(BenchmarkId::new("chain", n), &n, |b, &n| {
            b.iter_batched(
                || {
                    let mut e = engine();
                    set_num(&mut e, "B1", 0.0);
                    for i in 2..=n {
                        set(&mut e, &format!("B{i}"), &format!("=B{}+1", i - 1));
                    }
                    e
                },
                |mut e| {
                    black_box(e.recalculate().unwrap());
                },
                criterion::BatchSize::LargeInput,
            );
        });
        g.bench_with_input(BenchmarkId::new("wide", n), &n, |b, &n| {
            b.iter_batched(
                || {
                    let mut e = engine();
                    for i in 1..=n {
                        set_num(&mut e, &format!("B{i}"), f64::from(i));
                        set(&mut e, &format!("C{i}"), &format!("=B{i}*2"));
                    }
                    e
                },
                |mut e| {
                    black_box(e.recalculate().unwrap());
                },
                criterion::BatchSize::LargeInput,
            );
        });
    }
    g.finish();
}

fn bench_single_cell_change(c: &mut Criterion) {
    let mut g = c.benchmark_group("recalc/single_cell_change");
    g.sample_size(10);
    for n in [1_000u32, 10_000] {
        g.bench_with_input(BenchmarkId::new("chain_head", n), &n, |b, &n| {
            let mut e = chain_workbook(n);
            b.iter(|| {
                set_num(&mut e, "B1", 1.0);
                black_box(e.recalculate().unwrap());
            });
        });
        g.bench_with_input(BenchmarkId::new("wide", n), &n, |b, &n| {
            let mut e = wide_workbook(n);
            b.iter(|| {
                set_num(&mut e, "B1", 9.0);
                black_box(e.recalculate().unwrap());
            });
        });
    }
    g.bench_function("range_fan_10k", |b| {
        let mut e = range_workbook(10_000);
        b.iter(|| {
            set_num(&mut e, "B5000", 9.0);
            black_box(e.recalculate().unwrap());
        });
    });
    g.finish();
}

fn bench_fractional_change(c: &mut Criterion) {
    let mut g = c.benchmark_group("recalc/fractional_change");
    g.sample_size(10);
    let n = 10_000u32;
    g.bench_function("one_percent_wide_10k", |b| {
        let mut e = wide_workbook(n);
        b.iter(|| {
            for i in (1..=n).step_by(100) {
                set_num(&mut e, &format!("B{i}"), 7.0);
            }
            black_box(e.recalculate().unwrap());
        });
    });
    g.bench_function("full_change_wide_10k", |b| {
        let mut e = wide_workbook(n);
        b.iter(|| {
            for i in 1..=n {
                set_num(&mut e, &format!("B{i}"), 7.0);
            }
            black_box(e.recalculate().unwrap());
        });
    });
    g.finish();
}

criterion_group!(
    benches,
    bench_initial_calc,
    bench_single_cell_change,
    bench_fractional_change
);
criterion_main!(benches);
