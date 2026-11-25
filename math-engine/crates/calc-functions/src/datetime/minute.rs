//! `MINUTE(serial_number)` — minute (0–59) of a time serial.
//! Spec: `docs/functions/MINUTE.md`.
//!
//! Fractional part only; extraction shares the boundary-tolerant
//! [`date_serial::time_components`](crate::common::date_serial) helper
//! with `HOUR`/`SECOND`. Negative serials are `#NUM!`.

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
        Some((_, m, _)) => Ok(Value::Number(m as f64)),
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
    fn basic_minutes() {
        assert_eq!(n(&eval("=MINUTE(0.5)")), 0.0);
        assert_eq!(n(&eval("=MINUTE(TIME(15,45,30))")), 45.0);
        assert_eq!(n(&eval("=MINUTE(TIME(0,59,0))")), 59.0);
    }

    #[test]
    fn date_part_ignored() {
        assert_eq!(n(&eval("=MINUTE(45000.75)")), 0.0);
        let f = (18.0 * 3600.0 + 33.0 * 60.0) / 86_400.0;
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Number(45000.0 + f))],
                "=MINUTE(A1)"
            )),
            33.0
        );
    }

    #[test]
    fn minute_of_all_hours() {
        let f = (5.0 * 3600.0 + 30.0 * 60.0 + 30.0) / 86_400.0;
        assert_eq!(
            n(&eval_with(&[("A1", Value::Number(f))], "=MINUTE(A1)")),
            30.0
        );
    }

    #[test]
    fn seconds_carry_into_minute() {
        // 23:59:59 rounds within tolerance, stays minute 59.
        assert_eq!(n(&eval("=MINUTE(TIME(23,59,59))")), 59.0);
    }

    #[test]
    fn negative_serial_num() {
        assert_eq!(e(&eval("=MINUTE(-0.5)")), CalcError::Num);
    }

    #[test]
    fn midnight_wrap_minute() {
        // Fraction rounding to 24:00 wraps; minute is 0.
        assert_eq!(n(&eval("=MINUTE(0.9999999)")), 0.0);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=MINUTE("0.5")"#)), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MINUTE("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MINUTE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_zero() {
        assert_eq!(n(&eval("=MINUTE(A1)")), 0.0);
    }

    #[test]
    fn time_rollover_composes() {
        assert_eq!(n(&eval("=MINUTE(TIME(1,120,0))")), 0.0);
        assert_eq!(n(&eval("=MINUTE(TIME(0,61,0))")), 1.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MINUTE()")), CalcError::Value);
        assert_eq!(e(&eval("=MINUTE(1,2)")), CalcError::Value);
    }
}
