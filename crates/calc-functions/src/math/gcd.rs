//! `GCD(number1, [number2], ...)` — greatest common divisor.
//! Spec: `docs/functions/GCD.md`.
//!
//! Coercion follows the SUM-family model (`common::coercion::
//! collect_numbers`): ranged arguments contribute numbers only (text,
//! booleans and blanks inside ranges are ignored — SPEC-OPEN in the spec
//! doc); direct scalars coerce via `Value::to_number`. Each value is
//! truncated; a negative result or an input `>= 2^53` is `#NUM!`.
//! All-zero input returns `0` (SPEC-OPEN: Excel may return `#NUM!`).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

const LIMIT: f64 = 9_007_199_254_740_992.0; // 2^53

fn gcd(mut a: f64, mut b: f64) -> f64 {
    while b != 0.0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if nums.is_empty() {
        // SPEC-OPEN: empty-range behavior; #VALUE! chosen (no usable input).
        return Ok(Value::Error(CalcError::Value));
    }
    let mut acc = 0.0f64;
    for v in nums {
        let k = v.trunc();
        if k < 0.0 || k >= LIMIT {
            return Ok(Value::Error(CalcError::Num));
        }
        acc = gcd(acc, k);
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
        assert_eq!(n(&eval("=GCD(5,2)")), 1.0);
        assert_eq!(n(&eval("=GCD(24,36)")), 12.0);
        assert_eq!(n(&eval("=GCD(7,0)")), 7.0);
        assert_eq!(e(&eval("=GCD(-6,4)")), CalcError::Num);
    }

    #[test]
    fn multiple_args() {
        assert_eq!(n(&eval("=GCD(12,18,24)")), 6.0);
        assert_eq!(n(&eval("=GCD(60,36,48)")), 12.0);
    }

    #[test]
    fn truncates() {
        assert_eq!(n(&eval("=GCD(24.9,36.1)")), 12.0);
    }

    #[test]
    fn all_zeros() {
        // SPEC-OPEN: Excel may return #NUM!; 0 chosen per gcd(0,0)=0.
        assert_eq!(n(&eval("=GCD(0,0)")), 0.0);
    }

    #[test]
    fn over_limit_num() {
        assert_eq!(e(&eval("=GCD(9.007199254740992E+15,2)")), CalcError::Num);
    }

    #[test]
    fn range_args() {
        let v = eval_with(
            &[
                ("A1", 24.0.into()),
                ("A2", 36.0.into()),
                ("A3", 60.0.into()),
            ],
            "=GCD(A1:A3)",
        );
        assert_eq!(n(&v), 12.0);
    }

    #[test]
    fn range_ignores_text_and_blank() {
        // SPEC-OPEN: ranged members ignored per the aggregate model.
        let v = eval_with(&[("A1", 24.0.into()), ("A2", "x".into())], "=GCD(A1:A3)");
        assert_eq!(n(&v), 24.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=GCD("24","36")"#)), 12.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=GCD("x",2)"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=GCD(TRUE,4)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=GCD(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=GCD()")), CalcError::Value);
    }
}
