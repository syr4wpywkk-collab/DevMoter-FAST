//! `SECOND(serial_number)` — second (0–59) of a time serial.
//! Spec: `docs/functions/SECOND.md`.
//!
//! Fractional part only; shares the boundary-tolerant
//! [`date_serial::time_components`](crate::common::date_serial) helper
//! with `HOUR`/`MINUTE` (day fraction rounded to the nearest whole
//! second — SPEC-OPEN: Excel's sub-second rounding vs truncation).
//! Negative serials are `#NUM!`.

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
        Some((_, _, s)) => Ok(Value::Number(s as f64)),
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
    fn basic_seconds() {
        assert_eq!(n(&eval("=SECOND(0.5)")), 0.0);
        assert_eq!(n(&eval("=SECOND(TIME(15,45,30))")), 30.0);
        assert_eq!(n(&eval("=SECOND(TIME(0,0,59))")), 59.0);
    }

    #[test]
    fn date_part_ignored() {
        let f = (3600.0 + 2.0 * 60.0 + 7.0) / 86_400.0;
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Number(45000.0 + f))],
                "=SECOND(A1)"
            )),
            7.0
        );
    }

    #[test]
    fn fractional_second_truncated_by_time() {
        // TIME truncates fractional components before SECOND sees them.
        assert_eq!(n(&eval("=SECOND(TIME(0,0,30.9))")), 30.0);
    }

    #[test]
    fn second_59_and_0() {
        let f59 = 59.0 / 86_400.0;
        assert_eq!(
            n(&eval_with(&[("A1", Value::Number(f59))], "=SECOND(A1)")),
            59.0
        );
        assert_eq!(n(&eval("=SECOND(0)")), 0.0);
    }

    #[test]
    fn negative_serial_num() {
        assert_eq!(e(&eval("=SECOND(-0.5)")), CalcError::Num);
    }

    #[test]
    fn midnight_wrap_second() {
        assert_eq!(n(&eval("=SECOND(0.9999999)")), 0.0);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=SECOND("0.5")"#)), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=SECOND("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=SECOND(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_zero() {
        assert_eq!(n(&eval("=SECOND(A1)")), 0.0);
    }

    #[test]
    fn seconds_rollover_composes() {
        assert_eq!(n(&eval("=SECOND(TIME(0,0,90))")), 30.0);
        assert_eq!(n(&eval("=SECOND(TIME(0,1,-1))")), 59.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SECOND()")), CalcError::Value);
        assert_eq!(e(&eval("=SECOND(1,2)")), CalcError::Value);
    }
}
