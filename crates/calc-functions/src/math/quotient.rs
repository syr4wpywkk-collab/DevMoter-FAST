//! `QUOTIENT(numerator, denominator)` — integer portion of a division,
//! truncated toward zero. Spec: `docs/functions/QUOTIENT.md`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let num = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let den = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    if den == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let q = (num / den).trunc();
    if !q.is_finite() {
        // Non-finite numerator (SPEC-OPEN) or overflowing quotient.
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(q))
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
    fn basic() {
        assert_eq!(n(&eval("=QUOTIENT(5,2)")), 2.0);
    }

    #[test]
    fn negative_numerator_truncates_toward_zero() {
        // Unlike INT(-2.5) = -3.
        assert_eq!(n(&eval("=QUOTIENT(-5,2)")), -2.0);
    }

    #[test]
    fn negative_denominator() {
        assert_eq!(n(&eval("=QUOTIENT(5,-2)")), -2.0);
    }

    #[test]
    fn both_negative() {
        assert_eq!(n(&eval("=QUOTIENT(-5,-2)")), 2.0);
    }

    #[test]
    fn fractional_args() {
        assert_eq!(n(&eval("=QUOTIENT(4.5,3.1)")), 1.0);
    }

    #[test]
    fn spec_example() {
        assert_eq!(n(&eval("=QUOTIENT(-10,3)")), -3.0);
    }

    #[test]
    fn exact_division() {
        assert_eq!(n(&eval("=QUOTIENT(10,2)")), 5.0);
    }

    #[test]
    fn zero_numerator() {
        assert_eq!(n(&eval("=QUOTIENT(0,7)")), 0.0);
    }

    #[test]
    fn div_by_zero() {
        assert_eq!(e(&eval("=QUOTIENT(1,0)")), CalcError::DivZero);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=QUOTIENT(\"9\",\"2\")")), 4.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=QUOTIENT(\"x\",2)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=QUOTIENT(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=QUOTIENT(1)")), CalcError::Value);
        assert_eq!(e(&eval("=QUOTIENT(1,2,3)")), CalcError::Value);
    }
}
