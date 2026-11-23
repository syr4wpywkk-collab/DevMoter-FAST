//! `DEC2BIN(number, [places])` — decimal integer to binary text.
//! Spec: `docs/functions/DEC2BIN.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::format_radix;

/// Evaluate the optional `places` argument shared by the whole
/// `DEC2?`/`?2?` family: `None` when the argument is absent, else the
/// truncated `i64`. A blank cell coerces to `0` (SPEC-OPEN: whether
/// Excel treats blank places as omitted or as `0` — `0` is below any
/// positive result's width and therefore yields `#NUM!`).
pub(crate) fn eval_places(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    idx: usize,
) -> Result<Result<Option<i64>, CalcError>, EvalError> {
    if args.len() <= idx {
        return Ok(Ok(None));
    }
    let p = match ctx.eval(&args[idx])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    if p.is_nan() || p.abs() > 1e15 {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok(Some(p.trunc() as i64)))
}

/// Evaluate the decimal `number` argument shared by `DEC2BIN`/`DEC2HEX`/
/// `DEC2OCT`: coerces via [`Value::to_number`], truncates toward zero,
/// and enforces `min <= n <= max` (per-function bounds). `Err` is the
/// `CalcError` to emit.
pub(crate) fn eval_decimal(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
    min: f64,
    max: f64,
) -> Result<Result<i64, CalcError>, EvalError> {
    let n = match ctx.eval(arg)?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    let t = n.trunc();
    if t.is_nan() || t < min || t > max {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok(t as i64))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match eval_decimal(ctx, &args[0], -512.0, 511.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let places = match eval_places(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    match format_radix(n, 2, places) {
        Ok(s) => Ok(Value::Text(s)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn spec_examples() {
        assert_eq!(t(&eval("=DEC2BIN(9,4)")), "1001");
        assert_eq!(t(&eval("=DEC2BIN(-100)")), "1110011100");
        assert_eq!(t(&eval("=DEC2BIN(511)")), "111111111");
        assert_eq!(e(&eval("=DEC2BIN(5,2)")), CalcError::Num);
        assert_eq!(e(&eval("=DEC2BIN(512)")), CalcError::Num);
        assert_eq!(t(&eval("=DEC2BIN(4.9)")), "100");
    }

    #[test]
    fn negative_one() {
        assert_eq!(t(&eval("=DEC2BIN(-1)")), "1111111111");
        assert_eq!(t(&eval("=DEC2BIN(-512)")), "1000000000");
    }

    #[test]
    fn negative_fraction_truncates() {
        // SPEC-OPEN: truncation direction for negatives (toward zero).
        assert_eq!(t(&eval("=DEC2BIN(-4.9)")), "1111111100");
    }

    #[test]
    fn out_of_range_num() {
        assert_eq!(e(&eval("=DEC2BIN(-513)")), CalcError::Num);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval("=DEC2BIN(-1,3)")), "1111111111");
    }

    #[test]
    fn places_range_num() {
        assert_eq!(e(&eval("=DEC2BIN(1,-1)")), CalcError::Num);
        assert_eq!(e(&eval("=DEC2BIN(1,11)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(t(&eval(r#"=DEC2BIN("9","4")"#)), "1001");
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=DEC2BIN("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=DEC2BIN(9,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=DEC2BIN(A1)")), "0");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DEC2BIN(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=DEC2BIN(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DEC2BIN()")), CalcError::Value);
        assert_eq!(e(&eval("=DEC2BIN(1,2,3)")), CalcError::Value);
    }
}
