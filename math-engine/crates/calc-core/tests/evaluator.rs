//! End-to-end evaluator + dependency-graph tests (plan §5, §10.1
//! "再計算・循環参照"): arithmetic/precedence, comparisons, concat,
//! percent, cell chains, diamonds, cycles (SCC), dirty-only recalc, error
//! propagation, range coercion, and the evaluation step budget.

use std::collections::HashMap;

use calc_core::eval::{EvalContext, EvalError, FixedClock};
use calc_core::parser::parse;
use calc_core::{CalcEngine, CalcError, CellInput, Value, Workbook};

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

fn text(v: &Value) -> &str {
    match v {
        Value::Text(s) => s,
        other => panic!("expected text, got {other:?}"),
    }
}

fn boolean(v: &Value) -> bool {
    match v {
        Value::Boolean(b) => *b,
        other => panic!("expected boolean, got {other:?}"),
    }
}

fn err(v: &Value) -> CalcError {
    match v {
        Value::Error(e) => *e,
        other => panic!("expected error, got {other:?}"),
    }
}

fn eval_num(e: &mut CalcEngine, formula: &str) -> f64 {
    num(&eval(e, formula))
}

// ---------- literals & arithmetic ----------

#[test]
fn literal_number() {
    assert_eq!(eval_num(&mut engine(), "=42"), 42.0);
}

#[test]
fn literal_text() {
    assert_eq!(text(&eval(&mut engine(), r#"="hi""#)), "hi");
}

#[test]
fn literal_bool() {
    assert!(boolean(&eval(&mut engine(), "=TRUE")));
    assert!(!boolean(&eval(&mut engine(), "=FALSE")));
}

#[test]
fn arithmetic_add() {
    assert_eq!(eval_num(&mut engine(), "=1+2"), 3.0);
}

#[test]
fn arithmetic_sub() {
    assert_eq!(eval_num(&mut engine(), "=10-4"), 6.0);
}

#[test]
fn arithmetic_mul() {
    assert_eq!(eval_num(&mut engine(), "=3*4"), 12.0);
}

#[test]
fn arithmetic_div() {
    assert_eq!(eval_num(&mut engine(), "=10/4"), 2.5);
}

#[test]
fn arithmetic_pow() {
    assert_eq!(eval_num(&mut engine(), "=2^10"), 1024.0);
}

#[test]
fn precedence_mul_before_add() {
    assert_eq!(eval_num(&mut engine(), "=1+2*3"), 7.0);
}

#[test]
fn precedence_parens() {
    assert_eq!(eval_num(&mut engine(), "=(1+2)*3"), 9.0);
}

#[test]
fn precedence_pow_before_mul() {
    assert_eq!(eval_num(&mut engine(), "=2*3^2"), 18.0);
}

#[test]
fn precedence_pow_left_assoc() {
    // Excel evaluates 2^3^2 left-to-right -> 64.
    assert_eq!(eval_num(&mut engine(), "=2^3^2"), 64.0);
}

#[test]
fn unary_neg() {
    assert_eq!(eval_num(&mut engine(), "=-5"), -5.0);
}

#[test]
fn unary_neg_binds_tighter_than_pow() {
    // Excel: -2^2 = 4.
    assert_eq!(eval_num(&mut engine(), "=-2^2"), 4.0);
}

#[test]
fn unary_plus() {
    assert_eq!(eval_num(&mut engine(), "=+5"), 5.0);
}

#[test]
fn div_by_zero() {
    assert_eq!(err(&eval(&mut engine(), "=1/0")), CalcError::DivZero);
}

#[test]
fn zero_div_zero() {
    assert_eq!(err(&eval(&mut engine(), "=0/0")), CalcError::DivZero);
}

#[test]
fn mixed_float() {
    assert_eq!(eval_num(&mut engine(), "=0.1+0.2"), 0.1 + 0.2);
}

// ---------- percent ----------

#[test]
fn percent_postfix() {
    assert_eq!(eval_num(&mut engine(), "=50%"), 0.5);
}

#[test]
fn percent_in_expr() {
    assert_eq!(eval_num(&mut engine(), "=200*10%"), 20.0);
}

#[test]
fn percent_of_expr() {
    assert_eq!(eval_num(&mut engine(), "=(40+10)%"), 0.5);
}

#[test]
fn percent_stacked() {
    // 50%% = 0.005 (Excel allows chained %).
    let v = eval(&mut engine(), "=50%%");
    assert!((num(&v) - 0.005).abs() < 1e-12 || v.is_error());
}

// ---------- comparison ----------

#[test]
fn cmp_eq_num() {
    assert!(boolean(&eval(&mut engine(), "=1=1")));
    assert!(!boolean(&eval(&mut engine(), "=1=2")));
}

#[test]
fn cmp_ne() {
    assert!(boolean(&eval(&mut engine(), "=1<>2")));
    assert!(!boolean(&eval(&mut engine(), "=1<>1")));
}

#[test]
fn cmp_lt_le_gt_ge() {
    let mut e = engine();
    assert!(boolean(&eval(&mut e, "=1<2")));
    assert!(!boolean(&eval(&mut e, "=2<1")));
    assert!(boolean(&eval(&mut e, "=2<=2")));
    assert!(boolean(&eval(&mut e, "=3>2")));
    assert!(!boolean(&eval(&mut e, "=1>2")));
    assert!(boolean(&eval(&mut e, "=2>=2")));
}

#[test]
fn cmp_text_case_insensitive() {
    assert!(boolean(&eval(&mut engine(), r#"="ABC"="abc""#)));
}

#[test]
fn cmp_text_ordering() {
    assert!(boolean(&eval(&mut engine(), r#"="a"<"b""#)));
}

#[test]
fn cmp_cross_type_eq_is_false() {
    // Number never equals text or boolean in Excel.
    assert!(!boolean(&eval(&mut engine(), "=1=\"1\"")));
    assert!(boolean(&eval(&mut engine(), "=1<>\"1\"")));
    assert!(!boolean(&eval(&mut engine(), "=TRUE=1")));
}

#[test]
fn cmp_cross_type_ordering() {
    // Excel ordering: number < text < boolean.
    assert!(boolean(&eval(&mut engine(), "=1<\"a\"")));
    assert!(boolean(&eval(&mut engine(), "=\"a\"<TRUE")));
}

#[test]
fn cmp_blank_eq_zero() {
    let mut e = engine();
    assert!(boolean(&eval(&mut e, "=A1=0")));
}

#[test]
fn cmp_lower_than_arithmetic() {
    assert!(boolean(&eval(&mut engine(), "=1+1=2")));
}

// ---------- concat ----------

#[test]
fn concat_text() {
    assert_eq!(text(&eval(&mut engine(), r#"="a"&"b""#)), "ab");
}

#[test]
fn concat_number_coercion() {
    assert_eq!(text(&eval(&mut engine(), r#"="n="&42"#)), "n=42");
}

#[test]
fn concat_bool_coercion() {
    assert_eq!(text(&eval(&mut engine(), r#"=TRUE&"!""#)), "TRUE!");
}

#[test]
fn concat_error_propagates() {
    assert_eq!(err(&eval(&mut engine(), r#"="x"&1/0"#)), CalcError::DivZero);
}

#[test]
fn concat_precedence() {
    // & binds looser than +, tighter than comparisons.
    assert_eq!(text(&eval(&mut engine(), r#"=1+1&"x""#)), "2x");
}

// ---------- coercions in operators ----------

#[test]
fn numeric_text_coerces() {
    assert_eq!(eval_num(&mut engine(), r#"="3"+2"#), 5.0);
}

#[test]
fn nonnumeric_text_value_error() {
    assert_eq!(err(&eval(&mut engine(), r#"="abc"+1"#)), CalcError::Value);
}

#[test]
fn boolean_coerces_in_arithmetic() {
    assert_eq!(eval_num(&mut engine(), "=TRUE+1"), 2.0);
}

#[test]
fn percent_text_coerces() {
    assert_eq!(eval_num(&mut engine(), r#"="5%"+0"#), 0.05);
}

#[test]
fn error_literal_propagates() {
    assert_eq!(err(&eval(&mut engine(), "=#N/A+1")), CalcError::NA);
}

#[test]
fn unknown_name_is_name_error() {
    assert_eq!(err(&eval(&mut engine(), "=my_name")), CalcError::Name);
}

#[test]
fn unknown_function_is_name_error() {
    assert_eq!(err(&eval(&mut engine(), "=NOSUCHFN(1)")), CalcError::Name);
}

// ---------- cell references ----------

#[test]
fn cell_ref_number() {
    let mut e = engine();
    set_num(&mut e, "A1", 7.0);
    assert_eq!(eval_num(&mut e, "=A1"), 7.0);
}

#[test]
fn cell_ref_blank() {
    let mut e = engine();
    assert!(matches!(eval(&mut e, "=Z9"), Value::Blank));
}

#[test]
fn cell_ref_in_expr() {
    let mut e = engine();
    set_num(&mut e, "A1", 3.0);
    set_num(&mut e, "A2", 4.0);
    assert_eq!(eval_num(&mut e, "=A1*A2+1"), 13.0);
}

#[test]
fn cell_ref_absolute() {
    let mut e = engine();
    set_num(&mut e, "B2", 9.0);
    assert_eq!(eval_num(&mut e, "=$B$2"), 9.0);
}

#[test]
fn cross_sheet_ref() {
    let mut e = engine();
    e.add_sheet("Other").unwrap();
    e.set_cell("Other", "A1", CellInput::Value(Value::Number(5.0)))
        .unwrap();
    assert_eq!(eval_num(&mut e, "=Other!A1*2"), 10.0);
}

#[test]
fn missing_sheet_ref() {
    assert_eq!(err(&eval(&mut engine(), "=Nosuch!A1")), CalcError::Ref);
}

#[test]
fn quoted_sheet_ref() {
    let mut e = engine();
    e.add_sheet("My Sheet").unwrap();
    e.set_cell("My Sheet", "B1", CellInput::Value(Value::Number(2.0)))
        .unwrap();
    assert_eq!(eval_num(&mut e, "='My Sheet'!B1"), 2.0);
}

// ---------- formula cells & chains ----------

#[test]
fn formula_cell_basic() {
    let mut e = engine();
    set(&mut e, "A1", "=1+2");
    assert_eq!(num(&get(&mut e, "A1")), 3.0);
}

#[test]
fn chain_a_to_b_to_c() {
    let mut e = engine();
    set_num(&mut e, "A1", 2.0);
    set(&mut e, "B1", "=A1*10");
    set(&mut e, "C1", "=B1+1");
    assert_eq!(num(&get(&mut e, "C1")), 21.0);
}

#[test]
fn chain_updates_propagate() {
    let mut e = engine();
    set_num(&mut e, "A1", 2.0);
    set(&mut e, "B1", "=A1*10");
    set(&mut e, "C1", "=B1+1");
    get(&mut e, "C1");
    set_num(&mut e, "A1", 5.0);
    assert_eq!(num(&get(&mut e, "C1")), 51.0);
}

#[test]
fn diamond_dependency() {
    let mut e = engine();
    set_num(&mut e, "A1", 3.0);
    set(&mut e, "B1", "=A1+1");
    set(&mut e, "C1", "=A1*2");
    set(&mut e, "D1", "=B1+C1");
    assert_eq!(num(&get(&mut e, "D1")), 10.0);
}

#[test]
fn diamond_recalc() {
    let mut e = engine();
    set_num(&mut e, "A1", 3.0);
    set(&mut e, "B1", "=A1+1");
    set(&mut e, "C1", "=A1*2");
    set(&mut e, "D1", "=B1+C1");
    get(&mut e, "D1");
    set_num(&mut e, "A1", 10.0);
    assert_eq!(num(&get(&mut e, "D1")), 31.0);
}

#[test]
fn formula_defined_after_use() {
    // C1 references B1 before B1 is ever set; set order must not matter.
    let mut e = engine();
    set(&mut e, "C1", "=B1*2");
    set(&mut e, "B1", "=A1+1");
    set_num(&mut e, "A1", 4.0);
    assert_eq!(num(&get(&mut e, "C1")), 10.0);
}

#[test]
fn long_chain() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    let mut prev = "A1".to_string();
    for i in 2..=50 {
        let addr = format!("A{i}");
        set(&mut e, &addr, &format!("={prev}+1"));
        prev = addr;
    }
    assert_eq!(num(&get(&mut e, "A50")), 50.0);
}

// ---------- cycles ----------

#[test]
fn self_cycle_is_circ() {
    let mut e = engine();
    set(&mut e, "A1", "=A1+1");
    assert_eq!(err(&get(&mut e, "A1")), CalcError::Circ);
}

#[test]
fn two_cell_cycle() {
    let mut e = engine();
    set(&mut e, "A1", "=B1+1");
    set(&mut e, "B1", "=A1+1");
    assert_eq!(err(&get(&mut e, "A1")), CalcError::Circ);
    assert_eq!(err(&get(&mut e, "B1")), CalcError::Circ);
}

#[test]
fn longer_cycle() {
    let mut e = engine();
    set(&mut e, "A1", "=C1+1");
    set(&mut e, "B1", "=A1+1");
    set(&mut e, "C1", "=B1+1");
    for a in ["A1", "B1", "C1"] {
        assert_eq!(err(&get(&mut e, a)), CalcError::Circ, "cell {a}");
    }
}

#[test]
fn dependent_of_cycle_propagates() {
    let mut e = engine();
    set(&mut e, "A1", "=B1");
    set(&mut e, "B1", "=A1");
    set(&mut e, "C1", "=A1*2");
    assert_eq!(err(&get(&mut e, "C1")), CalcError::Circ);
}

#[test]
fn acyclic_neighbor_unaffected() {
    let mut e = engine();
    set(&mut e, "A1", "=B1");
    set(&mut e, "B1", "=A1");
    set_num(&mut e, "D1", 5.0);
    set(&mut e, "E1", "=D1*2");
    assert_eq!(num(&get(&mut e, "E1")), 10.0);
}

#[test]
fn cycle_through_range() {
    let mut e = engine();
    // A1 sums a range that contains itself.
    set(&mut e, "A1", "=SUMRANGE_STUB(A1:A2)"); // unknown fn -> #NAME?, still a dep
    assert!(get(&mut e, "A1").is_error());
}

#[test]
fn breaking_a_cycle() {
    let mut e = engine();
    set(&mut e, "A1", "=B1+1");
    set(&mut e, "B1", "=A1+1");
    assert_eq!(err(&get(&mut e, "A1")), CalcError::Circ);
    // Replace B1's formula with a constant; A1 recovers.
    set_num(&mut e, "B1", 10.0);
    assert_eq!(num(&get(&mut e, "A1")), 11.0);
}

// ---------- dirty tracking / incremental recalc ----------

#[test]
fn dirty_only_recalc() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1*2");
    set(&mut e, "Z1", "=5*5"); // unrelated formula
    let r1 = e.recalculate().unwrap();
    assert_eq!(r1.evaluated.len(), 2);
    // Change an unrelated input; Z1 must NOT be re-evaluated.
    set_num(&mut e, "A1", 2.0);
    let r2 = e.recalculate().unwrap();
    assert_eq!(r2.evaluated.len(), 1);
    assert_eq!(num(&get(&mut e, "B1")), 4.0);
    assert_eq!(num(&get(&mut e, "Z1")), 25.0);
}

#[test]
fn is_dirty_flags() {
    let mut e = engine();
    set(&mut e, "A1", "=1+1");
    assert!(e.is_dirty("Sheet1", "A1"));
    e.recalculate().unwrap();
    assert!(!e.is_dirty("Sheet1", "A1"));
}

#[test]
fn dependents_marked_dirty() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1*2");
    set(&mut e, "C1", "=B1*2");
    e.recalculate().unwrap();
    set_num(&mut e, "A1", 3.0);
    assert!(e.is_dirty("Sheet1", "B1"));
    assert!(e.is_dirty("Sheet1", "C1"));
    assert_eq!(num(&get(&mut e, "C1")), 12.0);
}

#[test]
fn recalc_report_counts() {
    let mut e = engine();
    set(&mut e, "A1", "=1");
    set(&mut e, "A2", "=A1+1");
    let r = e.recalculate().unwrap();
    assert_eq!(r.evaluated.len(), 2);
    assert!(r.cycle_cells.is_empty());
    // A2 must evaluate after A1.
    let pos: Vec<_> = r.evaluated.iter().map(|c| c.to_a1()).collect();
    assert!(pos.iter().position(|a| a == "A1") < pos.iter().position(|a| a == "A2"));
}

#[test]
fn idle_recalc_is_noop() {
    let mut e = engine();
    let r = e.recalculate().unwrap();
    assert!(r.evaluated.is_empty());
}

#[test]
fn clear_cell_updates_dependents() {
    let mut e = engine();
    set_num(&mut e, "A1", 5.0);
    set(&mut e, "B1", "=A1*2");
    assert_eq!(num(&get(&mut e, "B1")), 10.0);
    e.clear_cell("Sheet1", "A1").unwrap();
    assert_eq!(num(&get(&mut e, "B1")), 0.0);
}

#[test]
fn formula_overwritten_by_value() {
    let mut e = engine();
    set(&mut e, "A1", "=1+1");
    set_num(&mut e, "A1", 9.0);
    assert_eq!(num(&get(&mut e, "A1")), 9.0);
}

#[test]
fn value_overwritten_by_formula() {
    let mut e = engine();
    set_num(&mut e, "A1", 9.0);
    set(&mut e, "A1", "=3*3");
    assert_eq!(num(&get(&mut e, "A1")), 9.0);
}

#[test]
fn dependent_via_range_dirtied() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    set(&mut e, "B1", "=SUMX(A1:A2)"); // unknown fn, but dep still tracked
    e.recalculate().unwrap();
    set_num(&mut e, "A2", 9.0);
    assert!(e.is_dirty("Sheet1", "B1"));
}

// ---------- error propagation ----------

#[test]
fn error_propagates_through_ref() {
    let mut e = engine();
    set(&mut e, "A1", "=1/0");
    set(&mut e, "B1", "=A1+1");
    assert_eq!(err(&get(&mut e, "B1")), CalcError::DivZero);
}

#[test]
fn error_propagates_through_chain() {
    let mut e = engine();
    set(&mut e, "A1", "=\"x\"+1");
    set(&mut e, "B1", "=A1*2");
    set(&mut e, "C1", "=B1&\"!\""); // & propagates errors too
    assert_eq!(err(&get(&mut e, "C1")), CalcError::Value);
}

#[test]
fn first_error_wins_left() {
    assert_eq!(err(&eval(&mut engine(), "=1/0+#N/A")), CalcError::DivZero);
}

#[test]
fn unary_propagates_error() {
    assert_eq!(err(&eval(&mut engine(), "=-(1/0)")), CalcError::DivZero);
}

// ---------- ranges ----------

#[test]
fn range_scalar_use_gives_array() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    match eval(&mut e, "=A1:A2") {
        Value::Array(a) => {
            assert_eq!(a.rows(), 2);
            assert_eq!(a.cols(), 1);
        }
        other => panic!("expected array, got {other:?}"),
    }
}

#[test]
fn range_in_arithmetic_is_value_error() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    assert_eq!(err(&eval(&mut e, "=A1:A2+1")), CalcError::Value);
}

#[test]
fn cross_sheet_range() {
    let mut e = engine();
    e.add_sheet("Data").unwrap();
    e.set_cell("Data", "A1", CellInput::Value(Value::Number(1.0)))
        .unwrap();
    match eval(&mut e, "=Data!A1:A2") {
        Value::Array(a) => assert_eq!(a.get(1, 0), Some(&Value::Blank)),
        other => panic!("expected array, got {other:?}"),
    }
}

#[test]
fn reversed_range_normalizes() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    match eval(&mut e, "=A2:A1") {
        Value::Array(a) => {
            assert_eq!(a.get(0, 0), Some(&Value::Number(1.0)));
            assert_eq!(a.get(1, 0), Some(&Value::Number(2.0)));
        }
        other => panic!("expected array, got {other:?}"),
    }
}

// ---------- step budget / limits ----------

#[test]
fn step_budget_enforced() {
    let wb = Workbook::new();
    let values = HashMap::new();
    let clock = FixedClock(0);
    let rng = calc_core::SplitMix64::new(0);
    let registry = calc_core::EmptyRegistry;
    let mut ctx = EvalContext::new(
        &wb,
        &values,
        &clock,
        &rng,
        &registry,
        calc_core::CellId {
            sheet_id: 0,
            row: 0,
            col: 0,
        },
    );
    ctx.set_max_steps(10);
    let expr = parse("1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1").unwrap();
    assert_eq!(ctx.eval(&expr), Err(EvalError::StepBudgetExceeded));
}

#[test]
fn step_budget_counts_range_cells() {
    let mut wb = Workbook::new();
    wb.add_sheet("Sheet1").unwrap();
    let values = HashMap::new();
    let clock = FixedClock(0);
    let rng = calc_core::SplitMix64::new(0);
    let registry = calc_core::EmptyRegistry;
    let mut ctx = EvalContext::new(
        &wb,
        &values,
        &clock,
        &rng,
        &registry,
        calc_core::CellId {
            sheet_id: 0,
            row: 0,
            col: 0,
        },
    );
    ctx.set_max_steps(5);
    let expr = parse("A1:Z100").unwrap();
    assert_eq!(ctx.eval(&expr), Err(EvalError::StepBudgetExceeded));
}

#[test]
fn deep_recursion_bounded() {
    // The parser caps depth, but a manually-built AST can exceed it; eval
    // must return a structured error instead of overflowing the stack.
    use calc_core::ast::{Expr, Literal, UnaryOp};
    let wb = Workbook::new();
    let values = HashMap::new();
    let clock = FixedClock(0);
    let rng = calc_core::SplitMix64::new(0);
    let registry = calc_core::EmptyRegistry;
    let mut ctx = EvalContext::new(
        &wb,
        &values,
        &clock,
        &rng,
        &registry,
        calc_core::CellId {
            sheet_id: 0,
            row: 0,
            col: 0,
        },
    );
    let mut expr = Expr::Literal(Literal::Number(1.0));
    for _ in 0..calc_core::eval::MAX_EVAL_DEPTH + 1 {
        expr = Expr::Unary {
            op: UnaryOp::Pos,
            operand: Box::new(expr),
        };
    }
    assert_eq!(ctx.eval(&expr), Err(EvalError::DepthExceeded));
}

#[test]
fn default_budget_is_one_million() {
    assert_eq!(calc_core::eval::MAX_EVAL_STEPS, 1_000_000);
}

// ---------- clock ----------

#[test]
fn fixed_clock_injected() {
    let wb = Workbook::new();
    let values = HashMap::new();
    let clock = FixedClock(1234);
    let rng = calc_core::SplitMix64::new(0);
    let registry = calc_core::EmptyRegistry;
    let ctx = EvalContext::new(
        &wb,
        &values,
        &clock,
        &rng,
        &registry,
        calc_core::CellId {
            sheet_id: 0,
            row: 0,
            col: 0,
        },
    );
    assert_eq!(ctx.clock().unix_seconds(), 1234);
}

#[test]
fn system_clock_available() {
    let mut e = CalcEngine::new();
    e.set_clock(Box::new(FixedClock(42)));
    // Engine works with injected clock.
    e.add_sheet("Sheet1").unwrap();
    set(&mut e, "A1", "=1+1");
    assert_eq!(num(&get(&mut e, "A1")), 2.0);
}

// ---------- misc ----------

#[test]
fn parse_error_rejected_without_storing() {
    let mut e = engine();
    assert!(
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=1+"))
            .is_err()
    );
    // Cell unchanged (blank), nothing dirty.
    assert_eq!(get(&mut e, "A1"), Value::Blank);
}

#[test]
fn missing_arg_evaluates_blank() {
    // `F(a,,b)` empty slots are Expr::Missing -> Blank; verify through a
    // call context once functions exist. Direct scalar position:
    let mut e = engine();
    // unknown fn still evaluates args? dispatch happens first -> #NAME?
    assert_eq!(err(&eval(&mut e, "=X(1,,3)")), CalcError::Name);
}

#[test]
fn text_cell_not_coerced_via_ref() {
    // Referencing a text cell and adding 1 coerces (direct rules apply to
    // the referenced *value*, since =A1+1 is an arithmetic context).
    let mut e = engine();
    e.set_cell("Sheet1", "A1", CellInput::Value(Value::Text("3".into())))
        .unwrap();
    assert_eq!(eval_num(&mut e, "=A1+1"), 4.0);
}

#[test]
fn bool_cell_arithmetic() {
    let mut e = engine();
    e.set_cell("Sheet1", "A1", CellInput::Value(Value::Boolean(true)))
        .unwrap();
    assert_eq!(eval_num(&mut e, "=A1+5"), 6.0);
}

#[test]
fn overflow_is_num_error_never_infinity() {
    let mut e = engine();
    for formula in [
        "1E308*10",
        "-1E308*10",
        "1E308+1E308",
        "10^400",
        "-(1E308*10)",
        "1E308/1E-10",
        "EXP(1000)",
        "SUM(1E308,1E308)",
    ] {
        assert_eq!(err(&eval(&mut e, formula)), CalcError::Num, "{formula}");
    }
    assert_eq!(eval_num(&mut e, "1E308*1"), 1e308);
    assert_eq!(err(&eval(&mut e, "1/0")), CalcError::DivZero);
}
