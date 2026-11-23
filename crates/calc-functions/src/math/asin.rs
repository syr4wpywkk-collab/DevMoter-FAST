//! `ASIN(number)` — arcsine of `number` in radians, `[-PI/2, PI/2]`.
//! Spec: `docs/functions/ASIN.md`.
//!
//! Domain: `number` must be in `[-1, 1]`, otherwise `#NUM!`.

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
    if !(-1.0..=1.0).contains(&x) {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x.asin()))
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
        assert!((n(&eval("=ASIN(-0.5)")) - -std::f64::consts::FRAC_PI_6).abs() < 1e-12);
        assert!((n(&eval("=ASIN(1)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn zero_and_negative_one() {
        assert_eq!(n(&eval("=ASIN(0)")), 0.0);
        assert!((n(&eval("=ASIN(-1)")) - -std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn domain_error() {
        assert_eq!(e(&eval("=ASIN(1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=ASIN(-2)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ASIN("0.5")"#)) - std::f64::consts::FRAC_PI_6).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ASIN("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=ASIN(TRUE)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
        assert_eq!(n(&eval("=ASIN(FALSE)")), 0.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=ASIN(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ASIN(1/0)")), CalcError::DivZero);
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ASIN(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ASIN()")), CalcError::Value);
        assert_eq!(e(&eval("=ASIN(1,2)")), CalcError::Value);
    }
    #[test]
    fn odd_function() {
        assert_eq!(n(&eval("=ASIN(0.5)")), -n(&eval("=ASIN(-0.5)")));
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", (-0.5).into())], "=ASIN(A1)");
        assert!((n(&v) + std::f64::consts::FRAC_PI_6).abs() < 1e-12);
    }
}
