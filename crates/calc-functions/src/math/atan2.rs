//! `ATAN2(x_num, y_num)` — arctangent of the point `(x, y)` in
//! radians, `[-PI, PI]`. Spec: `docs/functions/ATAN2.md`.
//!
//! **Argument order is x first, y second** — the opposite of C/Python
//! `atan2(y, x)`; implementation is `f64::atan2(y, x)`. `ATAN2(0, 0)`
//! is `#DIV/0!` per the spec (IEEE would return 0).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let y = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if x == 0.0 && y == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(y.atan2(x)))
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
    fn first_quadrant() {
        assert!((n(&eval("=ATAN2(1,1)")) - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    }

    #[test]
    fn second_quadrant() {
        assert!((n(&eval("=ATAN2(-1,1)")) - 3.0 * std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    }

    #[test]
    fn fourth_quadrant() {
        assert!((n(&eval("=ATAN2(1,-1)")) + std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    }

    #[test]
    fn third_quadrant() {
        assert!((n(&eval("=ATAN2(-1,-1)")) + 2.356194490192345).abs() < 1e-12);
    }

    #[test]
    fn negative_x_axis() {
        assert!((n(&eval("=ATAN2(-1,0)")) - std::f64::consts::PI).abs() < 1e-12);
    }

    #[test]
    fn positive_y_axis() {
        assert!((n(&eval("=ATAN2(0,1)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn origin_divzero() {
        assert_eq!(e(&eval("=ATAN2(0,0)")), CalcError::DivZero);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ATAN2("1","1")"#)) - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ATAN2("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=ATAN2(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_refs_are_zero() {
        assert_eq!(e(&eval("=ATAN2(A1,B1)")), CalcError::DivZero);
        assert!((n(&eval("=ATAN2(-1,A1)")) - std::f64::consts::PI).abs() < 1e-12);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ATAN2(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ATAN2(1)")), CalcError::Value);
        assert_eq!(e(&eval("=ATAN2(1,1,1)")), CalcError::Value);
    }
}
