//! `FLOOR.MATH(number, [significance], [mode])` — round down to a
//! multiple of `significance`. Spec: `docs/functions/FLOOR.MATH.md`.
//!
//! Mirror of `CEILING.MATH`: `significance` sign is ignored; for negative
//! `number` a nonzero `mode` rounds toward +inf (toward zero) instead of
//! the default -inf.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 3) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let sig = if args.len() >= 2 {
        match ctx.eval(&args[1])?.to_number() {
            Ok(n) => n.abs(),
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        1.0
    };
    let mode = if args.len() == 3 {
        match ctx.eval(&args[2])?.to_number() {
            Ok(n) => n,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        0.0
    };
    // Negative x with nonzero mode flips the rounding direction to +inf.
    let up = x < 0.0 && mode != 0.0;
    Ok(Value::Number(crate::common::number::round_to_significance(
        x, sig, up,
    )))
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
    fn basic_positive() {
        assert_eq!(n(&eval("=FLOOR.MATH(4.3)")), 4.0);
        assert_eq!(n(&eval("=FLOOR.MATH(4.3,0.5)")), 4.0);
        assert_eq!(n(&eval("=FLOOR.MATH(24.5,6)")), 24.0);
    }

    #[test]
    fn negative_default_toward_neg_inf() {
        assert_eq!(n(&eval("=FLOOR.MATH(-4.3)")), -5.0);
        assert_eq!(n(&eval("=FLOOR.MATH(-8,3)")), -9.0);
    }

    #[test]
    fn negative_mode_toward_zero() {
        assert_eq!(n(&eval("=FLOOR.MATH(-4.3,1,1)")), -4.0);
        assert_eq!(n(&eval("=FLOOR.MATH(-8,3,-1)")), -6.0);
    }

    #[test]
    fn mode_ignored_for_positive() {
        assert_eq!(n(&eval("=FLOOR.MATH(4.3,1,1)")), 4.0);
    }

    #[test]
    fn negative_significance_abs() {
        assert_eq!(n(&eval("=FLOOR.MATH(4.3,-0.5)")), 4.0);
    }

    #[test]
    fn exact_multiple_unchanged() {
        assert_eq!(n(&eval("=FLOOR.MATH(6,6)")), 6.0);
        assert_eq!(n(&eval("=FLOOR.MATH(0.3,0.1)")), 0.3);
    }

    #[test]
    fn zero_significance() {
        assert_eq!(n(&eval("=FLOOR.MATH(4.3,0)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=FLOOR.MATH("4.3","2")"#)), 4.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=FLOOR.MATH("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FLOOR.MATH(1,2,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=FLOOR.MATH(TRUE)")), 1.0);
        assert_eq!(n(&eval("=FLOOR.MATH(-4.3,1,TRUE)")), -4.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=FLOOR.MATH(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=FLOOR.MATH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FLOOR.MATH(1,2,3,4)")), CalcError::Value);
    }
}
