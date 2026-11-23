//! Engine-level tests for the v3 reference mechanism (ADR 0002):
//! `Value::Reference`/`RefValue`, dereferencing in scalar and array
//! contexts, `eval_ref` reference semantics for arguments, text ->
//! reference parsing (`INDIRECT`-style), volatile dynamic references,
//! and the cell-metadata queries exposed on `EvalContext`.
//!
//! The mechanism is exercised through a *test-only* registry of
//! OFFSET/INDIRECT/FORMULATEXT/ISFORMULA/SHEET-shaped functions; the
//! real functions land in the implementation tracks and are not
//! registered here.

use calc_core::ast::Expr;
use calc_core::cell::RangeRef;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::reference::RefValue;
use calc_core::registry::{Function, FunctionRegistry};
use calc_core::{CalcEngine, CalcError, CellId, CellInput, CellRef, MAX_REF_TEXT_LEN, Value};

// ---------- test-only function registry ----------

/// A reference-producing function shaped like `OFFSET`:
/// `OFFSETLIKE(anchor, drow, dcol, [height], [width])`. Displaces the
/// anchor's top-left cell and optionally resizes; returns a
/// `Value::Reference`, never a value.
fn offset_like(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if !(3..=5).contains(&args.len()) {
        return Ok(Value::Error(CalcError::Value));
    }
    let anchor = match ctx.eval_ref(&args[0])? {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    let mut num = |i: usize| -> Result<Result<i64, CalcError>, EvalError> {
        Ok(ctx.eval(&args[i])?.to_number().map(|n| n as i64))
    };
    let drow = match num(1)? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let dcol = match num(2)? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let height = match args.get(3) {
        Some(e) => match ctx.eval(e)?.to_number() {
            Ok(n) => n as i64,
            Err(e) => return Ok(Value::Error(e)),
        },
        None => i64::from(anchor.rows()),
    };
    let width = match args.get(4) {
        Some(e) => match ctx.eval(e)?.to_number() {
            Ok(n) => n as i64,
            Err(e) => return Ok(Value::Error(e)),
        },
        None => i64::from(anchor.cols()),
    };
    if height < 1 || width < 1 {
        return Ok(Value::Error(CalcError::Ref));
    }
    let top = anchor.top_left();
    let row = i64::from(top.row) + drow;
    let col = i64::from(top.col) + dcol;
    let end_row = row + height - 1;
    let end_col = col + width - 1;
    if row < 0
        || col < 0
        || end_row >= i64::from(calc_core::MAX_ROWS)
        || end_col >= i64::from(calc_core::MAX_COLS)
    {
        return Ok(Value::Error(CalcError::Ref));
    }
    let mk = |row: u32, col: u32| CellRef {
        row,
        col,
        row_abs: false,
        col_abs: false,
    };
    Ok(Value::Reference(RefValue::new(
        anchor.sheet_id,
        RangeRef {
            start: mk(row as u32, col as u32),
            end: mk(end_row as u32, end_col as u32),
        },
    )))
}

/// `INDIRECT`-shaped: `INDIRECTLIKE(ref_text)` parses the text via
/// [`EvalContext::ref_from_a1_text`] and returns the reference.
/// Registered volatile (see [`TestRegistry::is_volatile`]).
fn indirect_like(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if args.len() != 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let text = match ctx.eval(&args[0])?.to_text() {
        Ok(t) => t,
        Err(e) => return Ok(Value::Error(e)),
    };
    match ctx.ref_from_a1_text(&text) {
        Ok(r) => Ok(Value::Reference(r)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// `TRUE` when the argument evaluates *as a reference* (eval_ref),
/// `FALSE` otherwise — exercises `eval_ref` without leaking the ref.
fn is_ref_arg(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if args.len() != 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    Ok(Value::Boolean(ctx.eval_ref(&args[0])?.is_ok()))
}

/// `FORMULATEXT`-shaped: top-left cell's stored formula text.
fn ftext(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if args.len() != 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let r = match ctx.eval_ref(&args[0])? {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    match ctx.cell_formula_text(r.top_left()) {
        Some(t) => Ok(Value::Text(t.to_string())),
        None => Ok(Value::Error(CalcError::NA)),
    }
}

/// `ISFORMULA`-shaped.
fn isf(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if args.len() != 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    match ctx.eval_ref(&args[0])? {
        Ok(r) => Ok(Value::Boolean(ctx.cell_is_formula(r.top_left()))),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// `SHEET()`-shaped: 1-based index of the argument's sheet, or of the
/// caller's sheet when the argument is omitted.
fn sheet_idx(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match args.first() {
        None => Ok(Value::Number(f64::from(ctx.caller().sheet_id + 1))),
        Some(expr) => match ctx.eval_ref(expr)? {
            Ok(r) => Ok(Value::Number(f64::from(r.sheet_id + 1))),
            Err(e) => Ok(Value::Error(e)),
        },
    }
}

/// `SHEETS()`-shaped: worksheet count.
fn sheet_count(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if !args.is_empty() {
        return Ok(Value::Error(CalcError::Value));
    }
    Ok(Value::Number(ctx.sheet_count() as f64))
}

/// 1-based row of the calling cell — proves caller-position plumbing.
fn caller_row(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if !args.is_empty() {
        return Ok(Value::Error(CalcError::Value));
    }
    Ok(Value::Number(f64::from(ctx.caller().row + 1)))
}

struct TestRegistry;

impl FunctionRegistry for TestRegistry {
    fn lookup(&self, name: &str) -> Option<Function> {
        Some(match name.to_ascii_uppercase().as_str() {
            "OFFSETLIKE" => offset_like,
            "INDIRECTLIKE" => indirect_like,
            "ISREFARG" => is_ref_arg,
            "FTEXT" => ftext,
            "ISF" => isf,
            "SHEETIDX" => sheet_idx,
            "SHEETN" => sheet_count,
            "CALLERROW" => caller_row,
            // Real aggregators, to prove references feed ordinary
            // functions transparently.
            _ => return calc_functions::default_registry().lookup(name),
        })
    }

    fn is_volatile(&self, name: &str) -> bool {
        name.eq_ignore_ascii_case("INDIRECTLIKE")
            || name.eq_ignore_ascii_case("OFFSETLIKE")
            || calc_functions::default_registry().is_volatile(name)
    }
}

// ---------- helpers ----------

fn engine() -> CalcEngine {
    let mut e = CalcEngine::new();
    e.set_registry(Box::new(TestRegistry));
    e.add_sheet("Sheet1").unwrap();
    e
}

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
        o => panic!("expected number, got {o:?}"),
    }
}

fn err(v: &Value) -> CalcError {
    match v {
        Value::Error(e) => *e,
        o => panic!("expected error, got {o:?}"),
    }
}

// ---------- OFFSET-style reference flow ----------

#[test]
fn offset_like_single_cell_derefs_to_value() {
    let mut e = engine();
    set_num(&mut e, "B2", 10.0);
    set(&mut e, "C1", "=OFFSETLIKE(A1,1,1)");
    assert_eq!(num(&get(&mut e, "C1")), 10.0);
}

#[test]
fn offset_like_range_feeds_sum() {
    // The returned reference dereferences to ArgValue::Range inside
    // SUM — range-side semantics, no reference object leaks through.
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    set_num(&mut e, "A3", 3.0);
    set(&mut e, "B1", "=SUM(OFFSETLIKE(A1,0,0,3,1))");
    assert_eq!(num(&get(&mut e, "B1")), 6.0);
}

#[test]
fn offset_like_result_spills() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "B1", 2.0);
    set_num(&mut e, "A2", 3.0);
    set_num(&mut e, "B2", 4.0);
    set(&mut e, "D1", "=OFFSETLIKE(A1,0,0,2,2)");
    assert_eq!(num(&get(&mut e, "D1")), 1.0);
    assert_eq!(num(&get(&mut e, "E1")), 2.0);
    assert_eq!(num(&get(&mut e, "D2")), 3.0);
    assert_eq!(num(&get(&mut e, "E2")), 4.0);
}

#[test]
fn offset_like_out_of_bounds_is_ref_error() {
    let mut e = engine();
    set(&mut e, "C1", "=OFFSETLIKE(A1,-1,0)");
    assert_eq!(err(&get(&mut e, "C1")), CalcError::Ref);
}

#[test]
fn nested_reference_consumers() {
    // OFFSET(OFFSET(...)): the inner call's Value::Reference reaches
    // the outer eval_ref, never a dereferenced scalar.
    let mut e = engine();
    set_num(&mut e, "B3", 42.0);
    set(&mut e, "C1", "=OFFSETLIKE(OFFSETLIKE(A1,1,1),1,0)");
    assert_eq!(num(&get(&mut e, "C1")), 42.0);
}

#[test]
fn offset_like_non_reference_anchor_is_value_error() {
    let mut e = engine();
    set(&mut e, "C1", "=OFFSETLIKE(5,1,1)");
    assert_eq!(err(&get(&mut e, "C1")), CalcError::Value);
    set(&mut e, "D1", r#"=OFFSETLIKE("A1",1,1)"#);
    assert_eq!(err(&get(&mut e, "D1")), CalcError::Value);
}

// ---------- INDIRECT-style text -> reference ----------

#[test]
fn indirect_like_resolves_text_to_value() {
    let mut e = engine();
    set_num(&mut e, "B2", 10.0);
    set(&mut e, "C1", r#"=INDIRECTLIKE("B2")"#);
    assert_eq!(num(&get(&mut e, "C1")), 10.0);
}

#[test]
fn indirect_like_concatenation_idiom() {
    let mut e = engine();
    set_num(&mut e, "B7", 99.0);
    set(&mut e, "A1", "B");
    set(&mut e, "C1", r#"=INDIRECTLIKE(A1&"7")"#);
    assert_eq!(num(&get(&mut e, "C1")), 99.0);
}

#[test]
fn indirect_like_range_text_feeds_sum() {
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set_num(&mut e, "A2", 2.0);
    set(&mut e, "C1", r#"=SUM(INDIRECTLIKE("A1:A2"))"#);
    assert_eq!(num(&get(&mut e, "C1")), 3.0);
}

#[test]
fn indirect_like_sheet_qualified() {
    let mut e = engine();
    e.add_sheet("Data Sheet").unwrap();
    e.set_cell("Data Sheet", "C3", CellInput::Value(Value::Number(7.0)))
        .unwrap();
    set(&mut e, "C1", r#"=INDIRECTLIKE("'Data Sheet'!C3")"#);
    assert_eq!(num(&get(&mut e, "C1")), 7.0);
}

#[test]
fn indirect_like_unparseable_text_is_ref_error() {
    let mut e = engine();
    for (cell, text) in [
        ("C1", "ZZZ999"),     // column beyond XFD
        ("C2", "A0"),         // row zero
        ("C3", "NoSheet!A1"), // unknown sheet
        ("C4", "hello!"),     // not a reference
        ("C5", ""),           // empty
        ("C6", "[1]S!A1"),    // external ref, unsupported
    ] {
        set(&mut e, cell, &format!(r#"=INDIRECTLIKE("{text}")"#));
        assert_eq!(err(&get(&mut e, cell)), CalcError::Ref, "{text}");
    }
}

#[test]
fn indirect_like_oversized_text_is_ref_error() {
    // Input-limit: text beyond MAX_REF_TEXT_LEN is rejected without a
    // parse attempt.
    let mut e = engine();
    let long = "A".repeat(MAX_REF_TEXT_LEN + 1);
    set(&mut e, "A1", &long);
    set(&mut e, "C1", "=INDIRECTLIKE(A1)");
    assert_eq!(err(&get(&mut e, "C1")), CalcError::Ref);
}

// ---------- volatility / dependency-graph correctness ----------

#[test]
fn volatile_ref_function_sees_untracked_change() {
    // The INDIRECTLIKE target is a runtime-computed reference: no
    // static Dep edge links C1 to B2. Only the volatile flag keeps C1
    // (and its dependents) correct when B2 changes.
    let mut e = engine();
    set_num(&mut e, "B2", 1.0);
    set(&mut e, "C1", r#"=INDIRECTLIKE("B2")"#);
    set(&mut e, "D1", "=C1*10");
    assert_eq!(num(&get(&mut e, "C1")), 1.0);
    assert_eq!(num(&get(&mut e, "D1")), 10.0);
    set_num(&mut e, "B2", 5.0);
    assert_eq!(num(&get(&mut e, "C1")), 5.0);
    assert_eq!(num(&get(&mut e, "D1")), 50.0);
}

#[test]
fn volatile_ref_function_recalcs_every_pass() {
    // A volatile ref cell is re-dirtied on every recalculate() call
    // even when nothing changed — conservative but correct.
    let mut e = engine();
    set_num(&mut e, "B2", 1.0);
    set(&mut e, "C1", r#"=OFFSETLIKE(B2,0,0)"#);
    let _ = get(&mut e, "C1");
    assert!(
        e.is_dirty("Sheet1", "C1") || {
            let report = e.recalculate().unwrap();
            report.evaluated.contains(&CellId {
                sheet_id: 0,
                row: 0,
                col: 2,
            })
        }
    );
}

#[test]
fn non_volatile_dependents_of_static_refs_still_track() {
    // Sanity: ordinary cells keep dependency tracking — the reference
    // machinery did not regress the static graph.
    let mut e = engine();
    set_num(&mut e, "A1", 1.0);
    set(&mut e, "B1", "=A1+1");
    assert_eq!(num(&get(&mut e, "B1")), 2.0);
    set_num(&mut e, "A1", 10.0);
    assert_eq!(num(&get(&mut e, "B1")), 11.0);
}

// ---------- eval_ref argument semantics ----------

#[test]
fn eval_ref_accepts_cell_and_range_refs() {
    let mut e = engine();
    set(&mut e, "C1", "=ISREFARG(A1)");
    set(&mut e, "C2", "=ISREFARG(A1:B2)");
    assert_eq!(get(&mut e, "C1"), Value::Boolean(true));
    assert_eq!(get(&mut e, "C2"), Value::Boolean(true));
}

#[test]
fn eval_ref_rejects_non_reference_args() {
    let mut e = engine();
    set(&mut e, "C1", "=ISREFARG(5)");
    set(&mut e, "C2", r#"=ISREFARG("A1")"#);
    assert_eq!(get(&mut e, "C1"), Value::Boolean(false));
    assert_eq!(get(&mut e, "C2"), Value::Boolean(false));
}

#[test]
fn eval_ref_sees_reference_valued_results() {
    let mut e = engine();
    set(&mut e, "C1", "=ISREFARG(OFFSETLIKE(A1,0,0))");
    assert_eq!(get(&mut e, "C1"), Value::Boolean(true));
}

#[test]
fn eval_ref_unknown_sheet_is_ref_error() {
    let mut e = engine();
    // Sheet-qualified refs to missing sheets parse but fail resolution.
    set(&mut e, "C1", "=ISF(NoSheet!A1)");
    assert_eq!(err(&get(&mut e, "C1")), CalcError::Ref);
}

// ---------- cell metadata queries ----------

#[test]
fn cell_formula_text_returns_stored_source() {
    let mut e = engine();
    set(&mut e, "B2", "=A1*2");
    set(&mut e, "C1", "=FTEXT(B2)");
    assert_eq!(get(&mut e, "C1"), Value::Text("A1*2".to_string()));
}

#[test]
fn cell_formula_text_on_literal_is_na() {
    let mut e = engine();
    set_num(&mut e, "B2", 42.0);
    set(&mut e, "C1", "=FTEXT(B2)");
    assert_eq!(err(&get(&mut e, "C1")), CalcError::NA);
}

#[test]
fn cell_is_formula() {
    let mut e = engine();
    set(&mut e, "B2", "=1+1");
    set_num(&mut e, "B3", 2.0);
    set(&mut e, "C1", "=ISF(B2)");
    set(&mut e, "C2", "=ISF(B3)");
    set(&mut e, "C3", "=ISF(B4)");
    assert_eq!(get(&mut e, "C1"), Value::Boolean(true));
    assert_eq!(get(&mut e, "C2"), Value::Boolean(false));
    assert_eq!(get(&mut e, "C3"), Value::Boolean(false)); // blank cell
}

#[test]
fn cell_is_formula_ignores_error_results() {
    // ISFORMULA checks the stored content, not the value: a formula
    // evaluating to an error still counts.
    let mut e = engine();
    set(&mut e, "B2", "=1/0");
    set(&mut e, "C1", "=ISF(B2)");
    assert_eq!(get(&mut e, "C1"), Value::Boolean(true));
}

#[test]
fn sheet_index_and_count() {
    let mut e = engine();
    e.add_sheet("Sheet2").unwrap();
    e.add_sheet("Sheet3").unwrap();
    set(&mut e, "C1", "=SHEETIDX(Sheet2!A1)");
    set(&mut e, "C2", "=SHEETIDX()");
    set(&mut e, "C3", "=SHEETN()");
    assert_eq!(num(&get(&mut e, "C1")), 2.0);
    assert_eq!(num(&get(&mut e, "C2")), 1.0); // caller's sheet
    assert_eq!(num(&get(&mut e, "C3")), 3.0);
}

#[test]
fn caller_position_is_the_formula_cell() {
    let mut e = engine();
    set(&mut e, "B5", "=CALLERROW()");
    assert_eq!(num(&get(&mut e, "B5")), 5.0);
}

// ---------- references stay invisible to the existing suite ----------

#[test]
fn reference_scalar_coercion_is_value_error() {
    // If a Value::Reference ever reaches scalar coercion directly it
    // must fail loudly, not silently coerce.
    let r = RefValue::single(
        0,
        CellRef {
            row: 0,
            col: 0,
            row_abs: false,
            col_abs: false,
        },
    );
    let v = Value::Reference(r);
    assert_eq!(v.to_number(), Err(CalcError::Value));
    assert_eq!(v.to_text(), Err(CalcError::Value));
    assert_eq!(v.to_boolean(), Err(CalcError::Value));
}
