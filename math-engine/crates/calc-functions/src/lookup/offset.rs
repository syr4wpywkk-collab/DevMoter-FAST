//! `OFFSET(reference, rows, cols, [height], [width])` — a reference
//! displaced from the anchor's top-left cell, optionally resized.
//! Volatile (already listed in `registry::VOLATILE_NAMES`). Spec:
//! `docs/functions/OFFSET.md`.
//!
//! Numeric arguments truncate toward zero. Negative `height`/`width`
//! extend the result upward/leftward from the displaced origin
//! (OFFSET.md open question — the bottom-right-anchored reading). Any
//! part of the result outside the grid is `#REF!`; a `0` extent is
//! `#REF!`.

use calc_core::ast::Expr;
use calc_core::cell::{CellRef, RangeRef};
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::reference::RefValue;
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let anchor = match ctx.eval_ref(&args[0])? {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    let drow = match offset_arg(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let dcol = match offset_arg(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let height = match extent(ctx, args.get(3), i64::from(anchor.rows()))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(h) => h,
    };
    let width = match extent(ctx, args.get(4), i64::from(anchor.cols()))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(w) => w,
    };
    if height == 0 || width == 0 {
        return Ok(Value::Error(CalcError::Ref));
    }

    let top = anchor.top_left();
    let r0 = i64::from(top.row) + drow;
    let c0 = i64::from(top.col) + dcol;
    // A negative extent grows the range upward/leftward so that the
    // displaced origin is the bottom-right cell: height -2 anchored at
    // row r covers r-1..=r.
    let (r0, r1) = if height < 0 {
        (r0 + height + 1, r0)
    } else {
        (r0, r0 + height - 1)
    };
    let (c0, c1) = if width < 0 {
        (c0 + width + 1, c0)
    } else {
        (c0, c0 + width - 1)
    };
    if r0 < 0
        || c0 < 0
        || r1 >= i64::from(calc_core::MAX_ROWS)
        || c1 >= i64::from(calc_core::MAX_COLS)
    {
        return Ok(Value::Error(CalcError::Ref));
    }
    let mk = |row: i64, col: i64| CellRef {
        row: row as u32,
        col: col as u32,
        row_abs: false,
        col_abs: false,
    };
    Ok(Value::Reference(RefValue::new(
        anchor.sheet_id,
        RangeRef {
            start: mk(r0, c0),
            end: mk(r1, c1),
        },
    )))
}

/// `rows`/`cols`: required, truncated toward zero.
fn offset_arg(ctx: &mut EvalContext<'_>, expr: &Expr) -> Result<Result<i64, CalcError>, EvalError> {
    let v = ctx.eval(expr)?;
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    Ok(v.to_number().map(|n| n.trunc() as i64))
}

/// `height`/`width`: `Expr::Missing`/blank -> `default`; otherwise a
/// truncated integer (sign kept — negative extents are legal).
fn extent(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: i64,
) -> Result<Result<i64, CalcError>, EvalError> {
    match expr {
        Some(Expr::Missing) | None => Ok(Ok(default)),
        Some(e) => {
            let v = ctx.eval(e)?;
            if v.is_blank() {
                return Ok(Ok(default));
            }
            Ok(v.to_number().map(|n| n.trunc() as i64))
        }
    }
}

#[cfg(test)]
mod tests {
    use calc_core::{CalcEngine, CalcError, CellInput, Value};

    fn engine() -> CalcEngine {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.add_sheet("Sheet1").unwrap();
        e
    }

    fn set_num(e: &mut CalcEngine, addr: &str, n: f64) {
        e.set_cell("Sheet1", addr, CellInput::Value(Value::Number(n)))
            .unwrap();
    }

    fn get(e: &mut CalcEngine, addr: &str) -> Value {
        e.get_value("Sheet1", addr).unwrap()
    }

    fn set(e: &mut CalcEngine, addr: &str, input: &str) {
        e.set_cell("Sheet1", addr, CellInput::from_typed(input))
            .unwrap();
    }

    fn n(v: &Value) -> f64 {
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

    #[test]
    fn displaced_single_cell() {
        let mut e = engine();
        set_num(&mut e, "B2", 10.0);
        set(&mut e, "C1", "=OFFSET(A1,1,1)");
        assert_eq!(n(&get(&mut e, "C1")), 10.0);
    }

    #[test]
    fn negative_displacement() {
        let mut e = engine();
        set_num(&mut e, "A1", 7.0);
        set(&mut e, "C1", "=OFFSET(B2,-1,-1)");
        assert_eq!(n(&get(&mut e, "C1")), 7.0);
    }

    #[test]
    fn resized_feeds_sum() {
        let mut e = engine();
        set_num(&mut e, "A1", 1.0);
        set_num(&mut e, "A2", 2.0);
        set_num(&mut e, "A3", 3.0);
        set(&mut e, "B1", "=SUM(OFFSET(A1,0,0,3,1))");
        assert_eq!(n(&get(&mut e, "B1")), 6.0);
    }

    #[test]
    fn anchor_size_preserved() {
        let mut e = engine();
        set_num(&mut e, "B2", 1.0);
        set_num(&mut e, "C2", 2.0);
        set_num(&mut e, "B3", 3.0);
        set_num(&mut e, "C3", 4.0);
        set(&mut e, "D1", "=SUM(OFFSET(A1:B2,1,1))");
        assert_eq!(n(&get(&mut e, "D1")), 10.0);
    }

    #[test]
    fn range_result_spills() {
        let mut e = engine();
        set_num(&mut e, "A1", 1.0);
        set_num(&mut e, "B1", 2.0);
        set_num(&mut e, "A2", 3.0);
        set_num(&mut e, "B2", 4.0);
        set(&mut e, "D1", "=OFFSET(A1,0,0,2,2)");
        assert_eq!(n(&get(&mut e, "D1")), 1.0);
        assert_eq!(n(&get(&mut e, "E1")), 2.0);
        assert_eq!(n(&get(&mut e, "D2")), 3.0);
        assert_eq!(n(&get(&mut e, "E2")), 4.0);
    }

    #[test]
    fn off_grid_is_ref() {
        let mut e = engine();
        set(&mut e, "B1", "=OFFSET(A1,-1,0)");
        set(&mut e, "B2", "=OFFSET(A1,0,-1)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Ref);
        assert_eq!(err(&get(&mut e, "B2")), CalcError::Ref);
    }

    #[test]
    fn beyond_max_grid_is_ref() {
        let mut e = engine();
        set(&mut e, "B1", "=OFFSET(XFD1048576,1,0)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Ref);
    }

    #[test]
    fn zero_extent_is_ref() {
        let mut e = engine();
        set(&mut e, "B1", "=OFFSET(A1,0,0,0,1)");
        set(&mut e, "B2", "=OFFSET(A1,0,0,1,0)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Ref);
        assert_eq!(err(&get(&mut e, "B2")), CalcError::Ref);
    }

    #[test]
    fn negative_height_extends_up() {
        let mut e = engine();
        set_num(&mut e, "A1", 1.0);
        set_num(&mut e, "A2", 2.0);
        set_num(&mut e, "A3", 3.0);
        // Origin A3; height -2 covers A2:A3 -> 5.
        set(&mut e, "B1", "=SUM(OFFSET(A3,0,0,-2,1))");
        assert_eq!(n(&get(&mut e, "B1")), 5.0);
    }

    #[test]
    fn non_reference_anchor() {
        let mut e = engine();
        set(&mut e, "B1", "=OFFSET(5,0,0)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Value);
    }

    #[test]
    fn fractional_offsets_truncate() {
        let mut e = engine();
        set_num(&mut e, "B2", 10.0);
        set(&mut e, "C1", "=OFFSET(A1,1.9,1.9)");
        assert_eq!(n(&get(&mut e, "C1")), 10.0);
    }

    #[test]
    fn volatile_recalculation() {
        let mut e = engine();
        set_num(&mut e, "B2", 10.0);
        set(&mut e, "C1", "=OFFSET(A1,1,1)");
        assert_eq!(n(&get(&mut e, "C1")), 10.0);
        // Untracked target change still recalculates (volatility).
        set_num(&mut e, "B2", 99.0);
        e.recalculate().unwrap();
        assert_eq!(n(&get(&mut e, "C1")), 99.0);
    }

    #[test]
    fn errors_propagate() {
        let mut e = engine();
        set(&mut e, "B1", "=OFFSET(A1,1/0,0)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::DivZero);
        set(&mut e, "B2", "=OFFSET(A1,0,0,1/0,1)");
        assert_eq!(err(&get(&mut e, "B2")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        let mut e = engine();
        set(&mut e, "B1", "=OFFSET(A1,0)");
        set(&mut e, "B2", "=OFFSET(A1,0,0,1,1,1)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Value);
        assert_eq!(err(&get(&mut e, "B2")), CalcError::Value);
    }
}
