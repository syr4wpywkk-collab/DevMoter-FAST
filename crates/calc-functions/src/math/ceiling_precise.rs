//! `CEILING.PRECISE(number, [significance])` — rounds `number` up to
//! the nearest multiple of `significance`, always **away from zero**
//! regardless of signs. Spec: `docs/functions/CEILING.PRECISE.md`.
//!
//! `significance` defaults to 1; its sign is ignored. Equivalent to
//! `ISO.CEILING`; differs from `CEILING.MATH` in that negatives always
//! round away from zero (no `mode` argument).

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
    // Away from zero: +inf for positive `x`, -inf for negative `x`.
    let up = x >= 0.0;
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
    fn spec_examples() {
        assert_eq!(n(&eval("=CEILING.PRECISE(4.3)")), 5.0);
        assert_eq!(n(&eval("=CEILING.PRECISE(-4.3)")), -5.0);
        assert_eq!(n(&eval("=CEILING.PRECISE(-8.8,3)")), -9.0);
    }

    #[test]
    fn fractional_significance() {
        assert_eq!(n(&eval("=CEILING.PRECISE(4.3,0.5)")), 4.5);
        assert_eq!(n(&eval("=CEILING.PRECISE(-4.3,0.5)")), -4.5);
    }

    #[test]
    fn significance_sign_ignored() {
        assert_eq!(n(&eval("=CEILING.PRECISE(4.3,-0.5)")), 4.5);
        assert_eq!(n(&eval("=CEILING.PRECISE(-4.3,-1)")), -5.0);
    }

    #[test]
    fn exact_multiple_unchanged() {
        assert_eq!(n(&eval("=CEILING.PRECISE(6,6)")), 6.0);
        assert_eq!(n(&eval("=CEILING.PRECISE(-6,6)")), -6.0);
    }

    #[test]
    fn zero_significance_returns_zero() {
        // Shared SPEC-OPEN with CEILING.MATH: Excel returns 0.
        assert_eq!(n(&eval("=CEILING.PRECISE(4.3,0)")), 0.0);
    }

    #[test]
    fn zero_input() {
        assert_eq!(n(&eval("=CEILING.PRECISE(0,5)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=CEILING.PRECISE("4.3","2")"#)), 6.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=CEILING.PRECISE("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=CEILING.PRECISE(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=CEILING.PRECISE(TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=CEILING.PRECISE(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CEILING.PRECISE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CEILING.PRECISE(1,2,3)")), CalcError::Value);
    }
}
