//! `CSCH(number)` — hyperbolic cosecant `1 / SINH(number)`.
//! Spec: `docs/functions/CSCH.md`.

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
    if x == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let s = x.sinh();
    if !s.is_finite() {
        // SINH overflows for |x| > ~710; Excel computes 1/SINH so the
        // overflow propagates as #NUM! (SPEC-OPEN: could also underflow
        // to 0 — confirm against a reference build).
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(1.0 / s))
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
        assert!((n(&eval("=CSCH(1)")) - 0.8509181282393216).abs() < 1e-15);
        assert!((n(&eval("=CSCH(2)")) - 0.27572056477178325).abs() < 1e-15);
    }

    #[test]
    fn odd_function() {
        assert!((n(&eval("=CSCH(-1)")) - -0.8509181282393216).abs() < 1e-15);
        assert_eq!(n(&eval("=CSCH(3)")), -n(&eval("=CSCH(-3)")));
    }

    #[test]
    fn zero_div_zero() {
        assert_eq!(e(&eval("=CSCH(0)")), CalcError::DivZero);
    }

    #[test]
    fn large_magnitude_toward_zero() {
        assert!((n(&eval("=CSCH(100)"))).abs() < 1e-40);
        assert!((n(&eval("=CSCH(-100)"))).abs() < 1e-40);
    }

    #[test]
    fn overflow_num() {
        // SPEC-OPEN: overflow-region behavior; implemented as #NUM!.
        assert_eq!(e(&eval("=CSCH(1000)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=CSCH("1")"#)) - 0.8509181282393216).abs() < 1e-15);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=CSCH("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=CSCH(TRUE)")) - 0.8509181282393216).abs() < 1e-15);
    }

    #[test]
    fn blank_ref_div_zero() {
        // Blank coerces to 0 -> #DIV/0!.
        assert_eq!(e(&eval("=CSCH(A1)")), CalcError::DivZero);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 2.0.into())], "=CSCH(A1)");
        assert!((n(&v) - 0.27572056477178325).abs() < 1e-15);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CSCH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CSCH(1,2)")), CalcError::Value);
    }
}
