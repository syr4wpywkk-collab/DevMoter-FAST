//! `RANDARRAY([rows], [columns], [min], [max], [whole_number])` — array
//! of random numbers. Spec: `docs/functions/RANDARRAY.md` (Excel 365 /
//! 2021+). Volatile: listed in [`crate::registry::VOLATILE_NAMES`].
//!
//! Decimal mode draws uniformly in `[min, max)`; integer mode draws
//! integers in `[min, max]` inclusive via the shared bias-free
//! [`random::uniform_i64`]. Per the spec doc, `rows`/`columns` < 1 or
//! non-integer is `#VALUE!` (the `#CALC!` alternative for a 0 size is
//! SPEC-OPEN there). In integer mode the bounds are truncated toward
//! zero (SPEC-OPEN: Excel's exact bound coercion for `RANDARRAY` is not
//! documented; `RANDBETWEEN` uses ceil/floor instead).

use crate::common::random;
use calc_core::array::{ArrayValue, MAX_ARRAY_CELLS};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 5) {
        return Ok(Value::Error(e));
    }
    let rows = match dim_arg(ctx, args.first())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let cols = match dim_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let min = match num_arg(ctx, args.get(2), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let max = match num_arg(ctx, args.get(3), 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let whole = match args.get(4) {
        None | Some(Expr::Missing) => false,
        Some(expr) => match ctx.eval(expr)?.to_boolean() {
            Ok(b) => b,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    if min > max || !min.is_finite() || !max.is_finite() {
        return Ok(Value::Error(CalcError::Value));
    }
    if rows as u64 * cols as u64 > MAX_ARRAY_CELLS as u64 {
        // Same policy as SEQUENCE for the array-size cap.
        return Ok(Value::Error(CalcError::Num));
    }

    let rng = ctx.rng();
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    if whole {
        let lo = min.trunc() as i64;
        let hi = max.trunc() as i64;
        if lo > hi || min < i64::MIN as f64 || max > i64::MAX as f64 {
            return Ok(Value::Error(CalcError::Value));
        }
        for _ in 0..rows * cols {
            cells.push(Value::Number(random::uniform_i64(rng, lo, hi) as f64));
        }
    } else {
        let span = max - min;
        for _ in 0..rows * cols {
            cells.push(Value::Number(min + random::unit_f64(rng) * span));
        }
    }
    match ArrayValue::new(rows, cols, cells) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Optional dimension argument (default 1): must be a positive integer —
/// non-integers and values < 1 are `#VALUE!` (SPEC-OPEN: `#CALC!` for 0).
fn dim_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<u32, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(1)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(1));
    }
    Ok(v.to_number().and_then(|n| {
        if n.is_finite() && n >= 1.0 && n.fract() == 0.0 && n <= u32::MAX as f64 {
            Ok(n as u32)
        } else {
            Err(CalcError::Value)
        }
    }))
}

/// Optional numeric bound; `Missing`/blank yields `default`.
fn num_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: f64,
) -> Result<Result<f64, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(default)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(default));
    }
    Ok(v.to_number())
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcEngine, CalcError, CellInput, Value};

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn arr(v: &Value) -> calc_core::array::ArrayValue {
        match v {
            Value::Array(a) => a.clone(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn engine() -> CalcEngine {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.add_sheet("Sheet1").unwrap();
        e
    }

    #[test]
    fn default_1x1_unit() {
        match eval("=RANDARRAY()") {
            Value::Array(a) => {
                assert_eq!((a.rows(), a.cols()), (1, 1));
                match a.get(0, 0) {
                    Some(Value::Number(x)) => assert!((0.0..1.0).contains(x)),
                    o => panic!("expected number, got {o:?}"),
                }
            }
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn shape_3x4() {
        let a = arr(&eval("=RANDARRAY(3,4)"));
        assert_eq!((a.rows(), a.cols()), (3, 4));
        for r in 0..3 {
            for c in 0..4 {
                match a.get(r, c) {
                    Some(Value::Number(x)) => assert!((0.0..1.0).contains(x)),
                    o => panic!("expected number, got {o:?}"),
                }
            }
        }
    }

    #[test]
    fn decimal_bounds() {
        let a = arr(&eval("=RANDARRAY(20,1,-5,10)"));
        for r in 0..20 {
            match a.get(r, 0) {
                Some(Value::Number(x)) => assert!((-5.0..10.0).contains(x), "{x}"),
                o => panic!("expected number, got {o:?}"),
            }
        }
    }

    #[test]
    fn whole_mode_integers() {
        let a = arr(&eval("=RANDARRAY(50,1,1,10,TRUE)"));
        for r in 0..50 {
            match a.get(r, 0) {
                Some(Value::Number(x)) => {
                    assert!((1.0..=10.0).contains(x) && x.fract() == 0.0, "{x}")
                }
                o => panic!("expected number, got {o:?}"),
            }
        }
    }

    #[test]
    fn whole_mode_numeric_bool() {
        let a = arr(&eval("=RANDARRAY(10,1,1,3,1)"));
        for r in 0..10 {
            match a.get(r, 0) {
                Some(Value::Number(x)) => assert!(x.fract() == 0.0),
                o => panic!("expected number, got {o:?}"),
            }
        }
    }

    #[test]
    fn volatile_recalcs() {
        let mut e = engine();
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=RANDARRAY(2,2)"))
            .unwrap();
        let first = e.get_value("Sheet1", "A1").unwrap();
        let second = e.get_value("Sheet1", "A1").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn seeded_reproducible() {
        use calc_core::SplitMix64;
        let mut e1 = engine();
        e1.set_rng(Box::new(SplitMix64::new(42)));
        e1.set_cell("Sheet1", "A1", CellInput::from_typed("=RANDARRAY(3,3)"))
            .unwrap();
        let mut e2 = engine();
        e2.set_rng(Box::new(SplitMix64::new(42)));
        e2.set_cell("Sheet1", "A1", CellInput::from_typed("=RANDARRAY(3,3)"))
            .unwrap();
        assert_eq!(
            e1.get_value("Sheet1", "A1").unwrap(),
            e2.get_value("Sheet1", "A1").unwrap()
        );
    }

    #[test]
    fn zero_rows_value() {
        // SPEC-OPEN: Excel may report #CALC! for a 0-size array.
        assert_eq!(e(&eval("=RANDARRAY(0,2)")), CalcError::Value);
    }

    #[test]
    fn noninteger_rows_value() {
        assert_eq!(e(&eval("=RANDARRAY(1.5,2)")), CalcError::Value);
    }

    #[test]
    fn min_gt_max_value() {
        assert_eq!(e(&eval("=RANDARRAY(1,1,10,1)")), CalcError::Value);
    }

    #[test]
    fn equal_bounds() {
        let a = arr(&eval("=RANDARRAY(2,1,5,5)"));
        assert_eq!(a.get(0, 0), Some(&Value::Number(5.0)));
        assert_eq!(a.get(1, 0), Some(&Value::Number(5.0)));
    }

    #[test]
    fn spills_as_array() {
        // INDEX reads individual cells of the spill.
        let v = eval("=INDEX(RANDARRAY(4,1,7,7),3)");
        assert_eq!(v, Value::Number(7.0));
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(e(&eval("=RANDARRAY(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=RANDARRAY(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=RANDARRAY(1,1,0,1,TRUE,9)")), CalcError::Value);
    }
}
