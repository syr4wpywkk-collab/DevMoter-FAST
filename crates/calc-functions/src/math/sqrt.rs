//! `SQRT(number)` — nonnegative square root. Spec: `docs/functions/SQRT.md`.

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
    if x < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    // -0 input: `x < 0` is false, `(-0).sqrt()` is `-0`; normalize to +0.
    Ok(Value::Number(x.sqrt() + 0.0))
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
        assert_eq!(n(&eval("=SQRT(4)")), 2.0);
        assert_eq!(n(&eval("=SQRT(0)")), 0.0);
        assert!((n(&eval("=SQRT(2)")) - std::f64::consts::SQRT_2).abs() < 1e-15);
    }

    #[test]
    fn negative_num() {
        assert_eq!(e(&eval("=SQRT(-1)")), CalcError::Num);
        assert_eq!(e(&eval("=SQRT(-0.5)")), CalcError::Num);
    }

    #[test]
    fn negative_zero_input() {
        let v = n(&eval("=SQRT(-0)"));
        assert_eq!(v, 0.0);
        assert!(v.is_sign_positive());
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval("=SQRT(0.25)")), 0.5);
    }

    #[test]
    fn large_finite() {
        assert!(n(&eval("=SQRT(1.7E308)")).is_finite());
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=SQRT("9")"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=SQRT("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=SQRT(TRUE)")), 1.0);
        assert_eq!(n(&eval("=SQRT(FALSE)")), 0.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=SQRT(A1)")), 0.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 16.0.into())], "=SQRT(A1)");
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=SQRT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SQRT(1,2)")), CalcError::Value);
    }
}
