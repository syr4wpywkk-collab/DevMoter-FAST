//! `TIME(hour, minute, second)` — builds a time-of-day serial in
//! `[0, 1)`. Spec: `docs/functions/TIME.md`.
//!
//! Components coerce per direct-scalar rules and truncate toward zero;
//! they roll over (`TIME(25,0,0)` = `TIME(1,0,0)`) and may be negative
//! while the *total* stays non-negative (`TIME(15,-30,0)` = 14:30).
//! Totals at or above 24 h wrap modulo one day; a negative total is
//! `#NUM!` (SPEC-OPEN: both bounds confirmed only for the common range).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let mut parts = [0i64; 3];
    for (i, arg) in args.iter().enumerate() {
        match ctx.eval(arg)?.to_number() {
            Ok(v) => parts[i] = date_serial::trunc_to_i64(v),
            Err(e) => return Ok(Value::Error(e)),
        }
    }
    let [h, m, s] = parts;
    let Some(total) = h
        .checked_mul(3600)
        .and_then(|t| m.checked_mul(60).and_then(|u| t.checked_add(u)))
        .and_then(|t| t.checked_add(s))
    else {
        return Ok(Value::Error(CalcError::Num));
    };
    if total < 0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((total % 86_400) as f64 / 86_400.0))
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
    fn basic_times() {
        assert_eq!(n(&eval("=TIME(0,0,0)")), 0.0);
        assert!((n(&eval("=TIME(12,0,0)")) - 0.5).abs() < 1e-12);
        assert!((n(&eval("=TIME(12,30,0)")) - 0.5208333333333334).abs() < 1e-12);
    }

    #[test]
    fn seconds_and_minutes_roll() {
        assert!((n(&eval("=TIME(0,0,90)")) - 90.0 / 86_400.0).abs() < 1e-12);
        assert!((n(&eval("=TIME(0,120,0)")) - 2.0 / 24.0).abs() < 1e-12);
    }

    #[test]
    fn hours_wrap_modulo_24() {
        assert!((n(&eval("=TIME(25,0,0)")) - 1.0 / 24.0).abs() < 1e-12);
        assert_eq!(n(&eval("=TIME(24,0,0)")), 0.0);
        assert!((n(&eval("=TIME(49,0,0)")) - 1.0 / 24.0).abs() < 1e-12);
    }

    #[test]
    fn negative_components_normalize() {
        // 15:00 - 30 min = 14:30.
        assert!((n(&eval("=TIME(15,-30,0)")) - 14.5 / 24.0).abs() < 1e-12);
        assert!((n(&eval("=TIME(0,-1,60)")) - 0.0).abs() < 1e-12);
    }

    #[test]
    fn negative_total_is_num() {
        assert_eq!(e(&eval("=TIME(-1,0,0)")), CalcError::Num);
        assert_eq!(e(&eval("=TIME(0,0,-1)")), CalcError::Num);
        assert_eq!(e(&eval("=TIME(1,-61,0)")), CalcError::Num);
    }

    #[test]
    fn fractional_args_truncate() {
        assert_eq!(n(&eval("=TIME(12.9,0,0)")), n(&eval("=TIME(12,0,0)")));
        assert_eq!(n(&eval("=TIME(0,0,30.9)")), n(&eval("=TIME(0,0,30)")));
    }

    #[test]
    fn text_numbers_coerce() {
        assert!((n(&eval(r#"=TIME("12","30","0")"#)) - 0.5208333333333334).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=TIME("x",0,0)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=TIME(1/0,0,0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_zero() {
        assert_eq!(n(&eval("=TIME(,0,0)")), 0.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=TIME(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=TIME(1,2,3,4)")), CalcError::Value);
    }

    #[test]
    fn composes_with_extractors() {
        assert_eq!(n(&eval("=HOUR(TIME(15,45,30))")), 15.0);
        assert_eq!(n(&eval("=MINUTE(TIME(15,45,30))")), 45.0);
        assert_eq!(n(&eval("=SECOND(TIME(15,45,30))")), 30.0);
    }
}
