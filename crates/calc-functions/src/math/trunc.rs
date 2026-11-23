//! `TRUNC(number, [num_digits])` — truncate toward zero.
//! Spec: `docs/functions/TRUNC.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let digits = if args.len() == 2 {
        match ctx.eval(&args[1])?.to_number() {
            // num_digits is itself truncated toward zero (Excel behavior).
            Ok(d) => d.trunc(),
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        0.0
    };
    Ok(Value::Number(trunc_digits(x, digits)))
}

/// `sign * floor(|x| * 10^d) / 10^d`, saturated for extreme `d`:
/// huge positive digits return `x`, huge negative digits return `0`.
fn trunc_digits(x: f64, digits: f64) -> f64 {
    if x == 0.0 || !digits.is_finite() {
        return if digits < 0.0 { 0.0 } else { x };
    }
    let d = digits.clamp(-400.0, 400.0);
    let f = 10f64.powf(d.abs());
    if !f.is_finite() {
        return if d > 0.0 { x } else { 0.0 };
    }
    if d >= 0.0 {
        let scaled = x * f;
        if scaled.is_finite() {
            scaled.trunc() / f
        } else {
            x
        }
    } else {
        (x / f).trunc() * f
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn toward_zero() {
        assert_eq!(n(&eval("=TRUNC(8.9)")), 8.0);
        // Differs from INT: TRUNC(-8.9) -> -8.
        assert_eq!(n(&eval("=TRUNC(-8.9)")), -8.0);
    }

    #[test]
    fn digits_positive() {
        assert_eq!(n(&eval("=TRUNC(3.15678,3)")), 3.156);
        assert_eq!(n(&eval("=TRUNC(-3.15678,2)")), -3.15);
    }

    #[test]
    fn digits_negative() {
        assert_eq!(n(&eval("=TRUNC(1234.567,-2)")), 1200.0);
        assert_eq!(n(&eval("=TRUNC(-1234.567,-2)")), -1200.0);
    }

    #[test]
    fn fractional_digits_truncated() {
        // num_digits itself truncates toward zero.
        assert_eq!(n(&eval("=TRUNC(3.15678,2.9)")), 3.15);
        assert_eq!(n(&eval("=TRUNC(1234.567,-1.9)")), 1230.0);
    }

    #[test]
    fn small_values_to_zero() {
        assert_eq!(n(&eval("=TRUNC(0.9)")), 0.0);
        assert_eq!(n(&eval("=TRUNC(-0.9)")), 0.0);
    }

    #[test]
    fn exact_integer_noop() {
        assert_eq!(n(&eval("=TRUNC(42,5)")), 42.0);
        assert_eq!(n(&eval("=TRUNC(-42)")), -42.0);
    }

    #[test]
    fn extreme_digits_saturate() {
        assert_eq!(n(&eval("=TRUNC(1.5,100)")), 1.5);
        assert_eq!(n(&eval("=TRUNC(1.5,-100)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=TRUNC("-8.9")"#)), -8.0);
        assert_eq!(n(&eval(r#"=TRUNC(3.99,"1")"#)), 3.9);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=TRUNC("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TRUNC(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=TRUNC(TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=TRUNC(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=TRUNC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=TRUNC(1,2,3)")), CalcError::Value);
    }
}
