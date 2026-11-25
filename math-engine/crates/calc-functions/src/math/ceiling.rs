//! `CEILING(number, significance)` — legacy ceiling: rounds `number`
//! up, away from zero, to the nearest multiple of `significance`.
//! Spec: `docs/functions/CEILING.md`.
//!
//! Classic semantics: `significance` must have the same sign as
//! `number`, otherwise `#NUM!`. (SPEC-OPEN: Excel 2016+/365 re-routed
//! legacy `CEILING` onto `CEILING.MATH`-style logic where mixed signs
//! no longer error — this implementation follows the documented
//! classic rule; see the spec's Open questions.)

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let sig = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if sig == 0.0 {
        // Shared open question with CEILING.MATH: Excel returns 0.
        return Ok(Value::Number(0.0));
    }
    // Classic rule: signs must agree (zero `x` matches either sign).
    if x != 0.0 && (x < 0.0) != (sig < 0.0) {
        return Ok(Value::Error(CalcError::Num));
    }
    // Same-sign input rounds away from zero: toward +inf for positive
    // `x`, toward -inf for negative `x`.
    let up = x >= 0.0;
    Ok(Value::Number(crate::common::number::round_to_significance(
        x,
        sig.abs(),
        up,
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
        assert_eq!(n(&eval("=CEILING(2.5,1)")), 3.0);
        assert_eq!(n(&eval("=CEILING(-2.5,-2)")), -4.0);
        assert_eq!(n(&eval("=CEILING(0.234,0.01)")), 0.24);
    }

    #[test]
    fn exact_multiple_unchanged() {
        assert_eq!(n(&eval("=CEILING(6,6)")), 6.0);
    }

    #[test]
    fn sign_mismatch_num_error() {
        assert_eq!(e(&eval("=CEILING(2.5,-1)")), CalcError::Num);
        assert_eq!(e(&eval("=CEILING(-2.5,1)")), CalcError::Num);
    }

    #[test]
    fn zero_significance_returns_zero() {
        assert_eq!(n(&eval("=CEILING(4.3,0)")), 0.0);
    }

    #[test]
    fn zero_number_either_sign() {
        assert_eq!(n(&eval("=CEILING(0,5)")), 0.0);
        assert_eq!(n(&eval("=CEILING(0,-5)")), 0.0);
    }

    #[test]
    fn fractional_significance() {
        assert_eq!(n(&eval("=CEILING(1.5,0.1)")), 1.5);
        assert_eq!(n(&eval("=CEILING(1.51,0.1)")), 1.6);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=CEILING("2.5","1")"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=CEILING("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=CEILING(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=CEILING(TRUE,1)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=CEILING(A1,5)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CEILING(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CEILING(1)")), CalcError::Value);
        assert_eq!(e(&eval("=CEILING(1,2,3)")), CalcError::Value);
    }
}
