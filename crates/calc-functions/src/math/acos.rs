//! `ACOS(number)` — arccosine of `number` in radians, `[0, PI]`.
//! Spec: `docs/functions/ACOS.md`.
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
    Ok(Value::Number(x.acos()))
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
        assert!((n(&eval("=ACOS(-0.5)")) - 2.0943951023931953).abs() < 1e-12);
        assert!((n(&eval("=ACOS(0)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn endpoints() {
        assert_eq!(n(&eval("=ACOS(1)")), 0.0);
        assert!((n(&eval("=ACOS(-1)")) - std::f64::consts::PI).abs() < 1e-12);
    }

    #[test]
    fn domain_error() {
        assert_eq!(e(&eval("=ACOS(2)")), CalcError::Num);
        assert_eq!(e(&eval("=ACOS(-1.5)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ACOS("0.5")"#)) - std::f64::consts::FRAC_PI_3).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ACOS("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ACOS(TRUE)")), 0.0);
        assert!((n(&eval("=ACOS(FALSE)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert!((n(&eval("=ACOS(A1)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ACOS(1/0)")), CalcError::DivZero);
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ACOS(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ACOS()")), CalcError::Value);
        assert_eq!(e(&eval("=ACOS(1,2)")), CalcError::Value);
    }
    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 0.5.into())], "=ACOS(A1)");
        assert!((n(&v) - std::f64::consts::FRAC_PI_3).abs() < 1e-12);
    }

    #[test]
    fn two_pi_over_three() {
        // ACOS(-0.5) = 2*PI/3 (spec example).
        assert!((n(&eval("=ACOS(-0.5)")) - 2.0943951023931953).abs() < 1e-12);
    }
}
