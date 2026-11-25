//! `HOUR(serial_number)` — hour (0–23) of a time serial.
//! Spec: `docs/functions/HOUR.md`.
//!
//! Only the fractional part matters; the date part is ignored.
//! Boundary-tolerant extraction via
//! [`date_serial::time_components`](crate::common::date_serial) rounds
//! the day fraction to the nearest second first. Negative serials are
//! `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let n = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    match date_serial::time_components(n) {
        Some((h, _, _)) => Ok(Value::Number(h as f64)),
        None => Ok(Value::Error(CalcError::Num)),
    }
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
    fn basic_hours() {
        assert_eq!(n(&eval("=HOUR(0.5)")), 12.0);
        assert_eq!(n(&eval("=HOUR(0)")), 0.0);
        assert_eq!(n(&eval("=HOUR(0.999)")), 23.0);
    }

    #[test]
    fn date_part_ignored() {
        assert_eq!(n(&eval("=HOUR(45000.75)")), 18.0);
    }

    #[test]
    fn via_time_function() {
        assert_eq!(n(&eval("=HOUR(TIME(15,30,0))")), 15.0);
        assert_eq!(n(&eval("=HOUR(TIME(23,59,59))")), 23.0);
    }

    #[test]
    fn negative_serial_num() {
        assert_eq!(e(&eval("=HOUR(-0.5)")), CalcError::Num);
        assert_eq!(e(&eval("=HOUR(-1)")), CalcError::Num);
    }

    #[test]
    fn fraction_rounding_up_wraps() {
        // A fraction within half a second of midnight rounds to 0:00.
        assert_eq!(n(&eval("=HOUR(0.9999999)")), 0.0);
    }

    #[test]
    fn hour_boundaries_exact() {
        for h in [1, 6, 11, 13, 22] {
            let f = h as f64 / 24.0;
            assert_eq!(
                n(&eval_with(&[("A1", Value::Number(f))], "=HOUR(A1)")),
                h as f64
            );
        }
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=HOUR("0.5")"#)), 12.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=HOUR("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=HOUR(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_zero() {
        assert_eq!(n(&eval("=HOUR(A1)")), 0.0);
    }

    #[test]
    fn composes_with_now_parts() {
        assert_eq!(n(&eval("=HOUR(TIME(25,0,0))")), 1.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=HOUR(1,2)")), CalcError::Value);
    }
}
