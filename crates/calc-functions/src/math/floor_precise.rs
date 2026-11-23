//! `FLOOR.PRECISE(number, [significance])` — rounds `number` down to a
//! multiple of `significance`, always toward negative infinity.
//! Spec: `docs/functions/FLOOR.PRECISE.md`.
//!
//! `significance` sign is ignored; `0` yields `0` (SPEC-OPEN, shared with
//! `FLOOR.MATH`). Equivalent to `FLOOR.MATH(number, significance, 0)`.

use crate::common::number::round_to_significance;
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
    let sig = if args.len() == 2 {
        match ctx.eval(&args[1])?.to_number() {
            Ok(n) => n.abs(),
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        1.0
    };
    Ok(Value::Number(round_to_significance(x, sig, false)))
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
    fn spec_examples() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(-3.2,-1)")), -4.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(3.2,-1)")), 3.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(0.234,0.01)")), 0.23);
    }

    #[test]
    fn defaults() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(4.3)")), 4.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(-4.3)")), -5.0);
    }

    #[test]
    fn always_toward_neg_inf() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(-4.3,1)")), -5.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(4.3,0.5)")), 4.0);
    }

    #[test]
    fn negative_significance_abs() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(4.3,-0.5)")), 4.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(-4.3,-1)")), -5.0);
    }

    #[test]
    fn exact_multiple() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(6,6)")), 6.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(-6,3)")), -6.0);
    }

    #[test]
    fn zero_significance() {
        // SPEC-OPEN: shared question with FLOOR.MATH; returns 0.
        assert_eq!(n(&eval("=FLOOR.PRECISE(4.3,0)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=FLOOR.PRECISE("4.3","2")"#)), 4.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=FLOOR.PRECISE("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FLOOR.PRECISE(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(TRUE)")), 1.0);
        assert_eq!(n(&eval("=FLOOR.PRECISE(4.3,TRUE)")), 4.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=FLOOR.PRECISE(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=FLOOR.PRECISE(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=FLOOR.PRECISE(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FLOOR.PRECISE(1,2,3)")), CalcError::Value);
    }
}
