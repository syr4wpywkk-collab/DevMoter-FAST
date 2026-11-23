//! `LCM(number1, [number2], ...)` — least common multiple.
//! Spec: `docs/functions/LCM.md`.
//!
//! Same coercion/truncation rules as `GCD`. If any argument is `0` the
//! result is `0`; results `>= 2^53` are `#NUM!`. The product is reduced by
//! the GCD before multiplying to postpone overflow.

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
        return Ok(Value::Error(CalcError::Value));
    }
    let mut acc = 1.0f64;
    for v in nums {
        let k = v.trunc();
        if k < 0.0 || k >= LIMIT {
            return Ok(Value::Error(CalcError::Num));
        }
        if k == 0.0 {
            return Ok(Value::Number(0.0));
        }
        // Divide by the gcd first so acc*k does not overflow prematurely.
        acc = acc / gcd(acc, k) * k;
        if acc >= LIMIT || !acc.is_finite() {
            return Ok(Value::Error(CalcError::Num));
        }
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
        assert_eq!(n(&eval("=LCM(5,2)")), 10.0);
        assert_eq!(n(&eval("=LCM(24,36)")), 72.0);
        assert_eq!(n(&eval("=LCM(5,0)")), 0.0);
    }

    #[test]
    fn multiple_args() {
        assert_eq!(n(&eval("=LCM(4,6,8)")), 24.0);
        assert_eq!(n(&eval("=LCM(3,5,7)")), 105.0);
    }

    #[test]
    fn single_arg() {
        // SPEC-OPEN: single argument returns itself.
        assert_eq!(n(&eval("=LCM(7)")), 7.0);
    }

    #[test]
    fn truncates() {
        assert_eq!(n(&eval("=LCM(5.9,2.1)")), 10.0);
    }

    #[test]
    fn negative_num() {
        assert_eq!(e(&eval("=LCM(-5,2)")), CalcError::Num);
    }

    #[test]
    fn over_limit_num() {
        assert_eq!(e(&eval("=LCM(9.007199254740992E+15,2)")), CalcError::Num);
        // Result >= 2^53 -> #NUM!.
        assert_eq!(e(&eval("=LCM(4294967296,4294967297)")), CalcError::Num);
    }

    #[test]
    fn range_args() {
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 6.0.into()), ("A3", 8.0.into())],
            "=LCM(A1:A3)",
        );
        assert_eq!(n(&v), 24.0);
    }

    #[test]
    fn range_ignores_text_and_blank() {
        let v = eval_with(&[("A1", 4.0.into()), ("A2", "x".into())], "=LCM(A1:A3)");
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=LCM("5","2")"#)), 10.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=LCM("x",2)"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=LCM(TRUE,4)")), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LCM(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LCM()")), CalcError::Value);
    }
}
