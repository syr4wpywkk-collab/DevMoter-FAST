//! `MULTINOMIAL(number1, [number2], ...)` — multinomial coefficient
//! `(a+b+c+...)! / (a! b! c! ...)`. Spec: `docs/functions/MULTINOMIAL.md`.
//!
//! Arguments are truncated toward zero; a negative truncated argument is
//! `#NUM!`. Computed in log space via `common::numerics::ln_gamma` to
//! avoid premature factorial overflow; the (mathematically integer)
//! result is rounded to the nearest integer. Non-finite -> `#NUM!`.
//! Ranged arguments follow the SUM-family model (non-numeric cells are
//! ignored — SPEC-OPEN in the spec doc).

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::Value));
    }
    let mut sum = 0.0f64;
    let mut denom_ln = 0.0f64;
    for v in nums {
        let k = v.trunc();
        if k < 0.0 {
            return Ok(Value::Error(CalcError::Num));
        }
        sum += k;
        denom_ln += numerics::ln_gamma(k + 1.0);
    }
    let r = (numerics::ln_gamma(sum + 1.0) - denom_ln).exp();
    if !r.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(r.round()))
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
        assert_eq!(n(&eval("=MULTINOMIAL(2,3,4)")), 1260.0);
        assert_eq!(n(&eval("=MULTINOMIAL(2)")), 1.0);
        assert_eq!(n(&eval("=MULTINOMIAL(1.9)")), 1.0);
    }

    #[test]
    fn symmetric_pairs() {
        // MULTINOMIAL(a,b) == C(a+b,a).
        assert_eq!(n(&eval("=MULTINOMIAL(3,2)")), 10.0);
        assert_eq!(n(&eval("=MULTINOMIAL(5,5)")), 252.0);
    }

    #[test]
    fn zeros() {
        assert_eq!(n(&eval("=MULTINOMIAL(0,0)")), 1.0);
        assert_eq!(n(&eval("=MULTINOMIAL(0,5)")), 1.0);
    }

    #[test]
    fn truncates() {
        assert_eq!(n(&eval("=MULTINOMIAL(2.9,3.1)")), 10.0);
    }

    #[test]
    fn negative_num() {
        assert_eq!(e(&eval("=MULTINOMIAL(-1,2)")), CalcError::Num);
    }

    #[test]
    fn overflow_num() {
        // MULTINOMIAL(1000,1000) ~ C(2000,1000) ~ 1.5e600 >> f64 max.
        assert_eq!(e(&eval("=MULTINOMIAL(1000,1000)")), CalcError::Num);
    }

    #[test]
    fn range_args() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 3.0.into()), ("A3", 4.0.into())],
            "=MULTINOMIAL(A1:A3)",
        );
        assert_eq!(n(&v), 1260.0);
    }

    #[test]
    fn range_ignores_text_and_blank() {
        // SPEC-OPEN: ranged blanks/text ignored per aggregate model.
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", "x".into())],
            "=MULTINOMIAL(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=MULTINOMIAL("2","3")"#)), 10.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MULTINOMIAL("x",2)"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=MULTINOMIAL(TRUE,2)")), 3.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MULTINOMIAL(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MULTINOMIAL()")), CalcError::Value);
    }
}
