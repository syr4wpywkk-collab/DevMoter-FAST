//! `ACOTH(number)` — inverse hyperbolic cotangent of `number`.
//! Spec: `docs/functions/ACOTH.md`.
//!
//! `ACOTH(x) = 0.5 * LN((x+1)/(x-1))`; domain `|x| > 1`, else `#NUM!`.

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
    if x.abs() <= 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(0.5 * ((x + 1.0) / (x - 1.0)).ln()))
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
        assert!((n(&eval("=ACOTH(6)")) - 0.1682361183106068).abs() < 1e-12);
        assert!((n(&eval("=ACOTH(-1.1)")) - -1.5222612188617113).abs() < 1e-12);
    }

    #[test]
    fn odd_function() {
        let a = n(&eval("=ACOTH(6)"));
        let b = n(&eval("=ACOTH(-6)"));
        assert!((a + b).abs() < 1e-15);
    }

    #[test]
    fn domain_boundaries() {
        assert_eq!(e(&eval("=ACOTH(1)")), CalcError::Num);
        assert_eq!(e(&eval("=ACOTH(-1)")), CalcError::Num);
        assert_eq!(e(&eval("=ACOTH(0)")), CalcError::Num);
        assert_eq!(e(&eval("=ACOTH(0.999)")), CalcError::Num);
    }

    #[test]
    fn large_abs_approaches_zero() {
        assert!(n(&eval("=ACOTH(1e6)")).abs() < 1e-5);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ACOTH("6")"#)) - 0.1682361183106068).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ACOTH("x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero_then_num() {
        assert_eq!(e(&eval("=ACOTH(A1)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ACOTH(1/0)")), CalcError::DivZero);
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ACOTH(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ACOTH()")), CalcError::Value);
        assert_eq!(e(&eval("=ACOTH(6,2)")), CalcError::Value);
    }

    #[test]
    fn closed_form_matches() {
        // ACOTH(x) = 0.5*LN((x+1)/(x-1)).
        let x = 3.0f64;
        let v = n(&eval("=ACOTH(3)"));
        assert!((v - 0.5 * ((x + 1.0) / (x - 1.0)).ln()).abs() < 1e-15);
    }
}
