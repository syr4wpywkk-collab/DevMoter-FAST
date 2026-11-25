//! Differential recalculation tests (v2 PR13): only the transitive
//! dependents of a changed cell re-evaluate — untouched branches, other
//! sheets, and cells reached through no dependency path must not appear
//! in `RecalcReport::evaluated`. Volatile cells and spill ranges are the
//! two carve-outs covered by regression tests below.

use std::collections::HashSet;

use calc_core::{CalcEngine, CellInput, Value};

// ---------- helpers ----------

fn engine() -> CalcEngine {
    let mut e = CalcEngine::new();
    e.set_registry(Box::new(calc_functions::default_registry()));
    e.add_sheet("Sheet1").unwrap();
    e
}

/// Set a cell from a typed string (`=...` is a formula, else text).
fn set(e: &mut CalcEngine, addr: &str, input: &str) {
    e.set_cell("Sheet1", addr, CellInput::from_typed(input))
        .unwrap();
}

fn set_num(e: &mut CalcEngine, addr: &str, n: f64) {
    e.set_cell("Sheet1", addr, CellInput::Value(Value::Number(n)))
        .unwrap();
}

fn get(e: &mut CalcEngine, addr: &str) -> Value {
    e.get_value("Sheet1", addr).unwrap()
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => *n,
        other => panic!("expected number, got {other:?}"),
    }
}

/// The A1 addresses a report evaluated, as a set.
fn evaluated_addrs(r: &calc_core::RecalcReport) -> HashSet<String> {
    r.evaluated.iter().map(|c| c.to_a1()).collect()
}

// ---------- branch isolation ----------

#[test]
fn untouched_branch_not_reevaluated() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1*2");
    set(&mut e, "C1", "=B1+1");
    // Independent branch: Z1 -> Z2 -> Z3.
    set_num(&mut e, "Z1", 5.0);
    set(&mut e, "Z2", "=Z1*2");
    set(&mut e, "Z3", "=Z2+1");
    e.recalculate().unwrap();

    set_num(&mut e, "A1", 3.0);
    let r = e.recalculate().unwrap();
    assert_eq!(
        evaluated_addrs(&r),
        HashSet::from(["B1".into(), "C1".into()])
    );
    assert_eq!(num(&get(&mut e, "C1")), 7.0);
    assert_eq!(num(&get(&mut e, "Z3")), 11.0);
}

#[test]
fn diamond_reevaluates_only_closure() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1+1");
    set(&mut e, "B2", "=A1*10");
    set(&mut e, "C1", "=B1+B2");
    set(&mut e, "Z1", "=99");
    e.recalculate().unwrap();

    set_num(&mut e, "A1", 2.0);
    let r = e.recalculate().unwrap();
    assert_eq!(
        evaluated_addrs(&r),
        HashSet::from(["B1".into(), "B2".into(), "C1".into()])
    );
    assert_eq!(num(&get(&mut e, "C1")), 23.0);
}

#[test]
fn change_inside_range_dirties_watcher_but_not_outside() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    set_num(&mut e, "A9", 7.0); // outside the watched range
    set(&mut e, "B1", "=SUM(A1:A3)");
    set(&mut e, "Z1", "=42");
    e.recalculate().unwrap();

    // Outside the range: no watcher re-evaluation.
    set_num(&mut e, "A9", 8.0);
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty(), "outside-change evaluated cells");

    // Inside the range: only the watcher re-evaluates.
    set_num(&mut e, "A2", 5.0);
    let r = e.recalculate().unwrap();
    assert_eq!(evaluated_addrs(&r), HashSet::from(["B1".into()]));
    assert_eq!(num(&get(&mut e, "B1")), 6.0);
}

#[test]
fn other_sheet_not_reevaluated() {
    let mut e = engine();
    e.add_sheet("Sheet2").unwrap();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1*2");
    e.set_cell("Sheet2", "B1", CellInput::from_typed("=A1*100"))
        .unwrap();
    e.recalculate().unwrap();

    set_num(&mut e, "A1", 4.0);
    let r = e.recalculate().unwrap();
    assert_eq!(evaluated_addrs(&r), HashSet::from(["B1".into()]));
    // Sheet2!B1 reads Sheet2's A1 (blank), untouched by Sheet1's change.
    assert_eq!(num(&e.get_value("Sheet2", "B1").unwrap()), 0.0);
}

#[test]
fn formula_retarget_updates_reverse_index() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    set(&mut e, "B1", "=A1*2");
    e.recalculate().unwrap();

    // Retarget B1 from A1 to A2: A1 changes must no longer dirty it.
    set(&mut e, "B1", "=A2*2");
    e.recalculate().unwrap();
    set_num(&mut e, "A1", 9.0);
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty(), "stale reverse edge re-evaluated B1");

    set_num(&mut e, "A2", 5.0);
    let r = e.recalculate().unwrap();
    assert_eq!(evaluated_addrs(&r), HashSet::from(["B1".into()]));
    assert_eq!(num(&get(&mut e, "B1")), 10.0);
}

#[test]
fn cleared_cell_stops_dependents_after_retire() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1*2");
    set_num(&mut e, "Z1", 0.0);
    e.recalculate().unwrap();

    // Overwrite B1 with a constant, then change A1: nothing may evaluate.
    set_num(&mut e, "B1", 42.0);
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty());
    set_num(&mut e, "A1", 9.0);
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty());
    assert_eq!(num(&get(&mut e, "B1")), 42.0);
}

// ---------- volatile cells under differential recalc ----------

#[test]
fn volatile_cell_reevaluates_every_pass() {
    let mut e = engine();
    set(&mut e, "B1", "=RAND()");
    set(&mut e, "C1", "=B1+1"); // dependent of a volatile cell
    set(&mut e, "Z1", "=1+1"); // untouched branch
    e.recalculate().unwrap();

    // No inputs changed: only the volatile cell and its dependent run.
    let r = e.recalculate().unwrap();
    assert_eq!(
        evaluated_addrs(&r),
        HashSet::from(["B1".into(), "C1".into()])
    );
}

#[test]
fn volatile_value_is_stable_across_reads() {
    let mut e = engine();
    set(&mut e, "B1", "=RAND()");
    let first = e.get_value("Sheet1", "B1").unwrap();
    assert_eq!(e.get_value("Sheet1", "B1").unwrap(), first);
    assert_eq!(e.eval_formula("Sheet1", "=B1").unwrap(), first);

    // An input change or an explicit recalculation reruns RAND().
    set_num(&mut e, "A9", 1.0);
    let r = e.recalculate().unwrap();
    assert!(evaluated_addrs(&r).contains("B1"));
    let after_edit = e.get_value("Sheet1", "B1").unwrap();
    assert_eq!(e.get_value("Sheet1", "B1").unwrap(), after_edit);
}

#[test]
fn rejected_edit_keeps_volatile_value() {
    let mut e = engine();
    set(&mut e, "B1", "=RAND()");
    let first = e.get_value("Sheet1", "B1").unwrap();
    assert!(
        e.set_cell("Sheet1", "C1", CellInput::Formula("1+".into()))
            .is_err()
    );
    assert_eq!(e.get_value("Sheet1", "B1").unwrap(), first);
}

#[test]
fn dynamic_reference_rereads_after_sheet_added() {
    let mut e = engine();
    set(&mut e, "A1", "=ISERROR(INDIRECT(\"Data!B1\"))");
    assert_eq!(e.get_value("Sheet1", "A1").unwrap(), Value::Boolean(true));
    e.add_sheet("Data").unwrap();
    assert_eq!(e.get_value("Sheet1", "A1").unwrap(), Value::Boolean(false));
}

#[test]
fn volatile_cell_removed_when_formula_retires() {
    let mut e = engine();
    set(&mut e, "B1", "=RAND()");
    e.recalculate().unwrap();
    set_num(&mut e, "B1", 0.5);
    e.recalculate().unwrap();

    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty(), "retired volatile cell still ran");
}

#[test]
fn volatile_added_later_via_registry_swap() {
    // Formulas entered under the default (empty) registry get their
    // volatile status recomputed when the real registry is installed.
    let mut e = CalcEngine::new();
    e.add_sheet("Sheet1").unwrap();
    set(&mut e, "B1", "=RAND()");
    e.recalculate().unwrap();
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty(), "volatile under EmptyRegistry?");

    e.set_registry(Box::new(calc_functions::default_registry()));
    let r = e.recalculate().unwrap();
    assert_eq!(evaluated_addrs(&r), HashSet::from(["B1".into()]));
}

// ---------- spill ranges under differential recalc ----------

#[test]
fn spill_dependent_reevaluates_on_resize() {
    let mut e = engine();
    set_num(&mut e, "A9", 2.0);
    set(&mut e, "E1", "=SEQUENCE(A9,2)"); // spills E1:F2 initially
    set(&mut e, "G3", "=F3*10"); // F3 only exists while the spill is 3 rows
    set(&mut e, "Z1", "=77"); // untouched branch
    e.recalculate().unwrap();
    assert_eq!(num(&get(&mut e, "G3")), 0.0);

    // Grow the spill to 3x2: F3 changes blank -> 6, so G3 must
    // re-evaluate even though F3 is a read-through value, not a formula.
    set_num(&mut e, "A9", 3.0);
    let r = e.recalculate().unwrap();
    assert_eq!(
        evaluated_addrs(&r),
        HashSet::from(["E1".into(), "G3".into()])
    );
    assert_eq!(num(&get(&mut e, "G3")), 60.0);
}

#[test]
fn spill_shrink_updates_dependent() {
    let mut e = engine();
    set_num(&mut e, "A9", 3.0);
    set(&mut e, "E1", "=SEQUENCE(A9,2)");
    set(&mut e, "G4", "=F3*1"); // F3 only exists while the spill is 3 rows
    e.recalculate().unwrap();
    assert_eq!(num(&get(&mut e, "G4")), 6.0);

    // Shrink to 2x2: F3 becomes blank again; G4 re-evaluates to 0.
    set_num(&mut e, "A9", 2.0);
    let r = e.recalculate().unwrap();
    assert_eq!(
        evaluated_addrs(&r),
        HashSet::from(["E1".into(), "G4".into()])
    );
    assert_eq!(num(&get(&mut e, "G4")), 0.0);
}

#[test]
fn spill_anchor_change_leaves_unrelated_cells_alone() {
    let mut e = engine();
    set(&mut e, "E1", "=SEQUENCE(2,2)");
    for i in 1..=20 {
        set(&mut e, &format!("H{i}"), &format!("={i}*2"));
    }
    e.recalculate().unwrap();

    // Re-entering the anchor formula dirties only the anchor.
    set(&mut e, "E1", "=SEQUENCE(2,2,10)");
    let r = e.recalculate().unwrap();
    assert_eq!(evaluated_addrs(&r), HashSet::from(["E1".into()]));
    assert_eq!(num(&get(&mut e, "F1")), 11.0);
}

// ---------- cycles under differential recalc ----------

#[test]
fn partial_cycle_detected_on_differential_recalc() {
    let mut e = engine();
    set(&mut e, "A1", "=B1+1");
    set(&mut e, "B1", "=A1+1");
    set(&mut e, "Z1", "=5");
    e.recalculate().unwrap();

    let r = e.recalculate().unwrap();
    // No new change: the cycle is settled, nothing re-evaluates.
    assert!(r.evaluated.is_empty());

    // Touch a member: both cycle cells re-evaluate to #CIRC!, Z1 stays out.
    set_num(&mut e, "Z1", 6.0); // unrelated change first
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty());
    set(&mut e, "A1", "=B1+2");
    let r = e.recalculate().unwrap();
    assert_eq!(r.cycle_cells.len(), 2);
    assert_eq!(evaluated_addrs(&r), HashSet::new());
}

#[test]
fn dynamic_reference_reads_target_evaluated_later() {
    let mut e = engine();
    set(&mut e, "B1", "=1");
    set(&mut e, "B2", "=B1*2");
    set(&mut e, "A1", "=INDIRECT(\"B2\")+0");
    assert_eq!(e.get_value("Sheet1", "A1").unwrap(), Value::Number(2.0));
    set(&mut e, "B1", "=5");
    assert_eq!(e.get_value("Sheet1", "A1").unwrap(), Value::Number(10.0));
}
