//! `FACTDOUBLE(number)` — double factorial `n!!` of the truncated
//! argument. Spec: `docs/functions/FACTDOUBLE.md`.
//!
//! Negative inputs: `n <= -2` -> `#NUM!`; `n = -1` and `n = 0` -> `1`
//! (SPEC-OPEN: Microsoft docs contradict themselves — `number < 0` is
//! documented as `#NUM!` yet `FACTDOUBLE(-1)=1` is stated explicitly; the
//! explicit values win here). Overflow -> `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let k = x.trunc();
    if k <= -2.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    if k < 1.0 {
        // k is -1 or 0 after truncation.
        return Ok(Value::Number(1.0));
    }
    let mut acc = 1.0f64;
    let mut i = k;
    while i >= 2.0 {
        acc *= i;
        i -= 2.0;
    }
    if !acc.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(acc))
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
        assert_eq!(n(&eval("=FACTDOUBLE(6)")), 48.0);
        assert_eq!(n(&eval("=FACTDOUBLE(7)")), 105.0);
        assert_eq!(n(&eval("=FACTDOUBLE(10)")), 3840.0);
    }

    #[test]
    fn zero_and_one() {
        assert_eq!(n(&eval("=FACTDOUBLE(0)")), 1.0);
        assert_eq!(n(&eval("=FACTDOUBLE(1)")), 1.0);
    }

    #[test]
    fn minus_one_is_one() {
        // SPEC-OPEN: MS docs contradiction; documented value is 1.
        assert_eq!(n(&eval("=FACTDOUBLE(-1)")), 1.0);
    }

    #[test]
    fn minus_two_num() {
        assert_eq!(e(&eval("=FACTDOUBLE(-2)")), CalcError::Num);
        assert_eq!(e(&eval("=FACTDOUBLE(-3)")), CalcError::Num);
    }

    #[test]
    fn truncates() {
        assert_eq!(n(&eval("=FACTDOUBLE(6.9)")), 48.0);
        // -1.9 truncates to -1 -> 1.
        assert_eq!(n(&eval("=FACTDOUBLE(-1.9)")), 1.0);
    }

    #[test]
    fn odd_and_even() {
        assert_eq!(n(&eval("=FACTDOUBLE(9)")), 945.0);
        assert_eq!(n(&eval("=FACTDOUBLE(8)")), 384.0);
    }

    #[test]
    fn overflow_num() {
        // SPEC-OPEN: exact overflow threshold (~301/302 even-side).
        assert_eq!(e(&eval("=FACTDOUBLE(302)")), CalcError::Num);
        assert_eq!(e(&eval("=FACTDOUBLE(1000)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=FACTDOUBLE("6")"#)), 48.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=FACTDOUBLE("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=FACTDOUBLE(TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_one() {
        assert_eq!(n(&eval("=FACTDOUBLE(A1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=FACTDOUBLE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FACTDOUBLE(1,2)")), CalcError::Value);
    }
}
