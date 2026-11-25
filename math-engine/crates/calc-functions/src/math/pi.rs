//! `PI()` — the constant pi. Spec: `docs/functions/PI.md`.
//!
//! Returns the f64 nearest to pi (Excel's 15 displayed digits are
//! 3.14159265358979; the stored value is the full f64 precision).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let _ = ctx;
    if let Err(e) = check_arity(args, 0, 0) {
        return Ok(Value::Error(e));
    }
    Ok(Value::Number(std::f64::consts::PI))
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
    fn returns_pi() {
        assert_eq!(n(&eval("=PI()")), std::f64::consts::PI);
    }

    #[test]
    fn fifteen_digits() {
        // Excel's displayed 15-digit value.
        assert_eq!(format!("{:.14}", n(&eval("=PI()"))), "3.14159265358979");
    }

    #[test]
    fn half_pi() {
        assert_eq!(n(&eval("=PI()/2")), std::f64::consts::FRAC_PI_2);
    }

    #[test]
    fn pi_squared() {
        let v = n(&eval("=PI()*PI()"));
        assert!((v - 9.869604401089358).abs() < 1e-14);
    }

    #[test]
    fn composes_with_trig() {
        assert!((n(&eval("=SIN(PI()/2)")) - 1.0).abs() < 1e-15);
    }

    #[test]
    fn arity_one_arg() {
        assert_eq!(e(&eval("=PI(1)")), CalcError::Value);
    }

    #[test]
    fn arity_two_args() {
        assert_eq!(e(&eval("=PI(1,2)")), CalcError::Value);
    }

    #[test]
    fn deterministic() {
        assert_eq!(eval("=PI()"), eval("=PI()"));
    }

    #[test]
    fn works_in_expression() {
        assert_eq!(n(&eval("=2*PI()")), std::f64::consts::TAU);
    }

    #[test]
    fn negative_pi() {
        assert_eq!(n(&eval("=-PI()")), -std::f64::consts::PI);
    }
}
