//! Dynamic-array tests (v2 PR10 core): array-literal parsing/eval and
//! the engine's spill mechanics — success, `#SPILL!` collisions, resize
//! on input change, dependents of spilled cells, and the 1M-cell limit.

use calc_core::parser::parse;
use calc_core::{CalcEngine, CalcError, CellInput, Value};

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

/// Evaluate a scratch formula on Sheet1.
fn eval(e: &mut CalcEngine, formula: &str) -> Value {
    e.eval_formula("Sheet1", formula).unwrap()
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => *n,
        other => panic!("expected number, got {other:?}"),
    }
}

fn err(v: &Value) -> CalcError {
    match v {
        Value::Error(e) => *e,
        other => panic!("expected error, got {other:?}"),
    }
}

fn array(v: Value) -> calc_core::ArrayValue {
    match v {
        Value::Array(a) => a,
        other => panic!("expected array, got {other:?}"),
    }
}

// ---------- array literals: parse ----------

#[test]
fn literal_parses() {
    let e = parse("={1,2;3,4}").unwrap();
    assert_eq!(e.node_count(), 5);
}

#[test]
fn literal_single_cell() {
    assert!(parse("={7}").is_ok());
}

#[test]
fn literal_expressions_as_elements() {
    assert!(parse("={1+1,SUM(1,2);\"a\",TRUE}").is_ok());
}

#[test]
fn literal_ragged_rows_rejected() {
    assert!(parse("={1,2;3}").is_err());
    assert!(parse("={1;2,3}").is_err());
}

#[test]
fn literal_unclosed_rejected() {
    assert!(parse("={1,2").is_err());
}

#[test]
fn literal_empty_rejected() {
    assert!(parse("={}").is_err());
    assert!(parse("={;}").is_err());
    assert!(parse("={1,}").is_err());
}

#[test]
fn semicolon_outside_literal_rejected() {
    assert!(parse("=1;2").is_err());
    assert!(parse("=SUM(1;2)").is_err());
}

// ---------- array literals: eval ----------

#[test]
fn literal_evaluates_to_array() {
    let mut e = engine();
    let a = array(eval(&mut e, "={1,2;3,4}"));
    assert_eq!(a.rows(), 2);
    assert_eq!(a.cols(), 2);
    assert_eq!(a.get(0, 0), Some(&Value::Number(1.0)));
    assert_eq!(a.get(0, 1), Some(&Value::Number(2.0)));
    assert_eq!(a.get(1, 0), Some(&Value::Number(3.0)));
    assert_eq!(a.get(1, 1), Some(&Value::Number(4.0)));
}

#[test]
fn literal_mixed_types_and_expressions() {
    let mut e = engine();
    let a = array(eval(&mut e, r#"={1+1,"x";TRUE,#N/A}"#));
    assert_eq!(a.get(0, 0), Some(&Value::Number(2.0)));
    assert_eq!(a.get(0, 1), Some(&Value::Text("x".to_string())));
    assert_eq!(a.get(1, 0), Some(&Value::Boolean(true)));
    assert_eq!(
        a.get(1, 1),
        Some(&Value::Error(CalcError::NA)),
        "errors stay elements"
    );
}

#[test]
fn literal_row_and_column_shapes() {
    let mut e = engine();
    let row = array(eval(&mut e, "={1,2,3}"));
    assert_eq!((row.rows(), row.cols()), (1, 3));
    let col = array(eval(&mut e, "={1;2;3}"));
    assert_eq!((col.rows(), col.cols()), (3, 1));
}

#[test]
fn operators_apply_element_wise_with_broadcast() {
    let mut e = engine();
    let cells = |v: Value| -> Vec<Value> {
        let a = array(v);
        a.iter().cloned().collect()
    };
    let n = |xs: &[f64]| xs.iter().map(|&x| Value::Number(x)).collect::<Vec<_>>();
    assert_eq!(cells(eval(&mut e, "={1,2}+1")), n(&[2.0, 3.0]));
    assert_eq!(cells(eval(&mut e, "=-{1,2}")), n(&[-1.0, -2.0]));
    assert_eq!(cells(eval(&mut e, "={50,200}%")), n(&[0.5, 2.0]));
    let grid = array(eval(&mut e, "={1,2}+{10;20}"));
    assert_eq!((grid.rows(), grid.cols()), (2, 2));
    assert_eq!(
        grid.iter().cloned().collect::<Vec<_>>(),
        n(&[11.0, 12.0, 21.0, 22.0])
    );
    let table = array(eval(&mut e, "=SEQUENCE(9)*SEQUENCE(1,9)"));
    assert_eq!((table.rows(), table.cols()), (9, 9));
    assert_eq!(table.get(8, 8), Some(&Value::Number(81.0)));
    assert_eq!(
        cells(eval(&mut e, "={1,2;3,4}*{10,100}")),
        n(&[10.0, 200.0, 30.0, 400.0])
    );
    assert_eq!(
        cells(eval(&mut e, "={1,2,3}+{1,2}")),
        vec![
            Value::Number(2.0),
            Value::Number(4.0),
            Value::Error(CalcError::NA)
        ]
    );
    assert_eq!(
        cells(eval(&mut e, "={1,2}>{0,5}")),
        vec![Value::Boolean(true), Value::Boolean(false)]
    );
    assert_eq!(
        cells(eval(&mut e, "={1,0}/{1,0}")),
        vec![Value::Number(1.0), Value::Error(CalcError::DivZero)]
    );
    assert_eq!(
        err(&eval(&mut e, "=SEQUENCE(1001)*SEQUENCE(1,1001)")),
        CalcError::Value
    );
}

// ---------- spill ----------

#[test]
fn formula_spills_right_and_down() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "B2")), 1.0, "anchor keeps top-left");
    assert_eq!(num(&get(&mut e, "C2")), 2.0);
    assert_eq!(num(&get(&mut e, "B3")), 3.0);
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
    assert_eq!(get(&mut e, "B4"), Value::Blank, "outside the rectangle");
    assert_eq!(get(&mut e, "D2"), Value::Blank);
}

#[test]
fn range_result_spills() {
    let mut e = engine();
    set_num(&mut e, "A1", 10.0);
    set_num(&mut e, "A2", 20.0);
    set(&mut e, "C1", "=A1:A2");
    assert_eq!(num(&get(&mut e, "C1")), 10.0);
    assert_eq!(num(&get(&mut e, "C2")), 20.0);
}

#[test]
fn spill_collision_value_cell() {
    let mut e = engine();
    set_num(&mut e, "C2", 99.0); // obstructs a 2x2 spill from B2
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(err(&get(&mut e, "B2")), CalcError::Spill);
    assert_eq!(num(&get(&mut e, "C2")), 99.0, "obstruction untouched");
    assert_eq!(get(&mut e, "B3"), Value::Blank, "nothing was written");
}

#[test]
fn spill_collision_formula_cell() {
    let mut e = engine();
    set(&mut e, "B3", "=1+1"); // a formula cell also obstructs
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(err(&get(&mut e, "B2")), CalcError::Spill);
    assert_eq!(num(&get(&mut e, "B3")), 2.0);
}

#[test]
fn typing_into_spill_causes_spill_error() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
    set_num(&mut e, "C3", 0.0);
    assert_eq!(err(&get(&mut e, "B2")), CalcError::Spill);
    assert_eq!(num(&get(&mut e, "C3")), 0.0);
    assert_eq!(get(&mut e, "C2"), Value::Blank, "old spill released");
}

#[test]
fn clearing_anchor_releases_spill() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
    e.clear_cell("Sheet1", "B2").unwrap();
    assert_eq!(get(&mut e, "C3"), Value::Blank);
    assert_eq!(get(&mut e, "B2"), Value::Blank);
}

#[test]
fn editing_anchor_respills() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
    set(&mut e, "B2", "={9}");
    assert_eq!(num(&get(&mut e, "B2")), 9.0);
    assert_eq!(get(&mut e, "C3"), Value::Blank);
}

#[test]
fn spill_grows_and_shrinks_with_input() {
    let mut e = engine();
    set_num(&mut e, "A1", 2.0); // controls SEQUENCE-like size via literal pick
    set(&mut e, "C1", "=IF(A1=1,{1},{1,2;3,4})");
    assert_eq!(num(&get(&mut e, "D2")), 4.0);
    set_num(&mut e, "A1", 1.0);
    assert_eq!(num(&get(&mut e, "C1")), 1.0);
    assert_eq!(get(&mut e, "D2"), Value::Blank, "shrink released cells");
    set_num(&mut e, "A1", 2.0);
    assert_eq!(num(&get(&mut e, "D2")), 4.0, "grow rewrote cells");
}

#[test]
fn dependent_reads_spilled_cell() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    set(&mut e, "E1", "=C3*10");
    assert_eq!(num(&get(&mut e, "E1")), 40.0);
}

#[test]
fn dependent_updates_when_spill_changes() {
    let mut e = engine();
    set_num(&mut e, "A1", 5.0);
    set(&mut e, "B2", "=A1:A2");
    set_num(&mut e, "A2", 7.0);
    set(&mut e, "E1", "=B3*2");
    assert_eq!(num(&get(&mut e, "E1")), 14.0);
    set_num(&mut e, "A2", 9.0);
    assert_eq!(num(&get(&mut e, "E1")), 18.0);
}

#[test]
fn dependent_updates_when_spill_released() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    set(&mut e, "E1", "=C3");
    assert_eq!(num(&get(&mut e, "E1")), 4.0);
    e.clear_cell("Sheet1", "B2").unwrap();
    assert_eq!(get(&mut e, "E1"), Value::Blank, "released cell reads blank");
}

#[test]
fn spill_over_other_spill_blocked() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "B2")), 1.0); // materialize the spill
    // A3's 1x2 spill would cover B3, which is owned by B2's spill.
    set(&mut e, "A3", "={8,9}");
    assert_eq!(err(&get(&mut e, "A3")), CalcError::Spill);
    // The earlier spill is untouched.
    assert_eq!(num(&get(&mut e, "B3")), 3.0);
}

#[test]
fn anchor_cell_is_not_obstructed_by_own_spill() {
    let mut e = engine();
    // A formula sitting inside another anchor's target rect obstructs
    // *that* anchor, but still evaluates itself.
    set(&mut e, "B2", "={1,2;3,4}");
    set(&mut e, "C3", "={8,9}");
    assert_eq!(err(&get(&mut e, "B2")), CalcError::Spill);
    assert_eq!(num(&get(&mut e, "C3")), 8.0);
}

#[test]
fn clearing_spill_cell_rewrites_it() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    e.clear_cell("Sheet1", "C3").unwrap();
    // Clearing a read-through cell does not break the spill: the anchor
    // re-evaluates and rewrites it.
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
}

#[test]
fn spill_at_sheet_edge() {
    let mut e = engine();
    // XFD is the last column; a 1x2 spill anchored there runs off-grid.
    set(&mut e, "XFD1", "={1,2}");
    assert_eq!(err(&get(&mut e, "XFD1")), CalcError::Spill);
    // A 1x1 at the corner still fits.
    set(&mut e, "XFD1048576", "={42}");
    assert_eq!(num(&get(&mut e, "XFD1048576")), 42.0);
}

#[test]
fn scalar_results_do_not_spill() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "B2")), 1.0); // materialize the spill
    set(&mut e, "B2", "=SUM(C2:D3)");
    // Was an array, now scalar: the old spill is released *before* the
    // new formula evaluates, so SUM sees the now-blank range.
    assert_eq!(num(&get(&mut e, "B2")), 0.0);
    assert_eq!(get(&mut e, "C2"), Value::Blank);
}

#[test]
fn error_result_releases_old_spill() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
    set(&mut e, "B2", "=1/0");
    assert_eq!(err(&get(&mut e, "B2")), CalcError::DivZero);
    assert_eq!(get(&mut e, "C3"), Value::Blank);
}

#[test]
fn array_cell_limit_enforced() {
    let mut e = engine();
    // Ranges are capped at MAX_ARRAY_CELLS; a whole column is over.
    assert_eq!(err(&eval(&mut e, "=A1:A1048576")), CalcError::Value);
}

#[test]
fn spilled_cells_are_not_stored_inputs() {
    let mut e = engine();
    set(&mut e, "B2", "={1,2;3,4}");
    get(&mut e, "B2");
    // The spill cells have read-through values but no stored input.
    assert!(e.workbook().cell_a1("Sheet1", "C3").unwrap().is_none());
    assert_eq!(num(&get(&mut e, "C3")), 4.0);
}

#[test]
fn uncalled_lambda_cell_is_calc_error() {
    let mut e = engine();
    set(&mut e, "A1", "=LAMBDA(x,x)");
    assert_eq!(get(&mut e, "A1"), Value::Error(CalcError::Calc));
}

#[test]
fn scalar_error_operand_broadcasts_over_array() {
    let mut e = engine();
    for formula in ["#N/A+{1,2}", "{1,2}+#N/A"] {
        let a = array(eval(&mut e, formula));
        assert_eq!((a.rows(), a.cols()), (1, 2), "{formula}");
        assert!(a.iter().all(|v| err(v) == CalcError::NA), "{formula}");
    }
    assert_eq!(err(&eval(&mut e, "#N/A+1")), CalcError::NA);
}
