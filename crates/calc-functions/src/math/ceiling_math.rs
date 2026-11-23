//! `CEILING.MATH(number, [significance], [mode])` — round up to a
//! multiple of `significance`. Spec: `docs/functions/CEILING.MATH.md`.
//!
//! `significance` sign is ignored (absolute value). `mode` matters only
//! for negative `number`: nonzero rounds away from zero (toward -inf);
//! zero/omitted rounds toward zero.

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
    // Negative x with nonzero mode flips the rounding direction to -inf.
    let up = !(x < 0.0 && mode != 0.0);
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
        assert_eq!(n(&eval("=CEILING.MATH(4.3)")), 5.0);
        assert_eq!(n(&eval("=CEILING.MATH(4.3,0.5)")), 4.5);
        assert_eq!(n(&eval("=CEILING.MATH(24.5,6)")), 30.0);
    }

    #[test]
    fn negative_default_toward_zero() {
        assert_eq!(n(&eval("=CEILING.MATH(-4.3)")), -4.0);
        assert_eq!(n(&eval("=CEILING.MATH(-8,3)")), -6.0);
    }

    #[test]
    fn negative_mode_away_from_zero() {
        assert_eq!(n(&eval("=CEILING.MATH(-4.3,1,1)")), -5.0);
        assert_eq!(n(&eval("=CEILING.MATH(-4.3,1,-2)")), -5.0);
    }

    #[test]
    fn mode_ignored_for_positive() {
        assert_eq!(n(&eval("=CEILING.MATH(4.3,1,1)")), 5.0);
    }

    #[test]
    fn negative_significance_abs() {
        assert_eq!(n(&eval("=CEILING.MATH(4.3,-0.5)")), 4.5);
        assert_eq!(n(&eval("=CEILING.MATH(-4.3,-1)")), -4.0);
    }

    #[test]
    fn exact_multiple_unchanged() {
        assert_eq!(n(&eval("=CEILING.MATH(6,6)")), 6.0);
        assert_eq!(n(&eval("=CEILING.MATH(0.3,0.1)")), 0.3);
    }

    #[test]
    fn zero_significance() {
        assert_eq!(n(&eval("=CEILING.MATH(4.3,0)")), 0.0);
    }

    #[test]
    fn zero_input() {
        assert_eq!(n(&eval("=CEILING.MATH(0,5)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=CEILING.MATH("4.3","2")"#)), 6.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=CEILING.MATH("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=CEILING.MATH(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=CEILING.MATH(TRUE)")), 1.0);
        assert_eq!(n(&eval("=CEILING.MATH(-4.3,1,TRUE)")), -5.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=CEILING.MATH(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CEILING.MATH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CEILING.MATH(1,2,3,4)")), CalcError::Value);
    }
}
