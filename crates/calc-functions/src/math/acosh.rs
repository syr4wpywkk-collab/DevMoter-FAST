//! `ACOSH(number)` — inverse hyperbolic cosine of `number`.
//! Spec: `docs/functions/ACOSH.md`.
//!
//! Domain: `number >= 1`, otherwise `#NUM!`.

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
    if x < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x.acosh()))
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
        assert_eq!(n(&eval("=ACOSH(1)")), 0.0);
        assert!((n(&eval("=ACOSH(10)")) - 2.993222846126381).abs() < 1e-12);
    }

    #[test]
    fn domain_error() {
        assert_eq!(e(&eval("=ACOSH(0.5)")), CalcError::Num);
        assert_eq!(e(&eval("=ACOSH(0)")), CalcError::Num);
        assert_eq!(e(&eval("=ACOSH(-3)")), CalcError::Num);
    }

    #[test]
    fn monotonic_large() {
        let a = n(&eval("=ACOSH(100)"));
        let b = n(&eval("=ACOSH(10)"));
        assert!(a > b);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=ACOSH("1")"#)), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ACOSH("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ACOSH(TRUE)")), 0.0);
        assert_eq!(e(&eval("=ACOSH(FALSE)")), CalcError::Num);
    }

    #[test]
    fn blank_ref_is_zero_then_num() {
        // Blank coerces to 0, which fails the >= 1 domain check.
        assert_eq!(e(&eval("=ACOSH(A1)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ACOSH(1/0)")), CalcError::DivZero);
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ACOSH(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ACOSH()")), CalcError::Value);
        assert_eq!(e(&eval("=ACOSH(1,2)")), CalcError::Value);
    }
    #[test]
    fn closed_form_equivalent() {
        // ACOSH(x) == LN(x + SQRT(x^2 - 1)) within fp tolerance.
        let x = 7.5f64;
        let v = n(&eval("=ACOSH(7.5)"));
        assert!((v - (x + (x * x - 1.0).sqrt()).ln()).abs() < 1e-12);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 10.0.into())], "=ACOSH(A1)");
        assert!((n(&v) - 2.993222846126381).abs() < 1e-12);
    }
}
