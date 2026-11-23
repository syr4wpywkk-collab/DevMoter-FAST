//! `DAY(serial_number)` — day of month (1–31) of a date serial.
//! Spec: `docs/functions/DAY.md`.
//!
//! Same coercion, truncation and domain rules as `YEAR`/`MONTH`.
//! Serial 60 (fictitious 1900-02-29) reports 29; serial 0 reports 0
//! (the "1900-01-00" quirk — SPEC-OPEN fixture pins the Excel match).

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
    if n < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match date_serial::serial_to_date(date_serial::trunc_to_i64(n), ctx.date_system()) {
        Some((_, _, d)) => Ok(Value::Number(d as f64)),
        None => Ok(Value::Error(CalcError::Num)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::workbook::DateSystem;
    use calc_core::{CalcEngine, CalcError, Value};

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

    fn eval_1904(formula: &str) -> Value {
        let mut eng = CalcEngine::new();
        eng.set_registry(Box::new(crate::registry::default_registry()));
        eng.add_sheet("Sheet1").unwrap();
        eng.workbook_mut().set_date_system(DateSystem::Excel1904);
        eng.eval_formula("Sheet1", formula).unwrap()
    }

    #[test]
    fn basic_days() {
        assert_eq!(n(&eval("=DAY(45000)")), 15.0); // 2023-03-15
        assert_eq!(n(&eval("=DAY(1)")), 1.0);
        assert_eq!(n(&eval("=DAY(2958465)")), 31.0);
    }

    #[test]
    fn fraction_ignored() {
        assert_eq!(n(&eval("=DAY(45000.999)")), 15.0);
    }

    #[test]
    fn serial_zero_reports_zero() {
        assert_eq!(n(&eval("=DAY(0)")), 0.0);
    }

    #[test]
    fn bug_window_serial_60() {
        assert_eq!(n(&eval("=DAY(59)")), 28.0);
        assert_eq!(n(&eval("=DAY(60)")), 29.0);
        assert_eq!(n(&eval("=DAY(61)")), 1.0);
    }

    #[test]
    fn negative_serial_num() {
        assert_eq!(e(&eval("=DAY(-1)")), CalcError::Num);
        assert_eq!(e(&eval("=DAY(-0.5)")), CalcError::Num);
    }

    #[test]
    fn beyond_max_num() {
        assert_eq!(e(&eval("=DAY(2958466)")), CalcError::Num);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=DAY("45000")"#)), 15.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=DAY("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DAY(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_serial_zero() {
        assert_eq!(n(&eval("=DAY(A1)")), 0.0);
    }

    #[test]
    fn system_1904() {
        assert_eq!(n(&eval_1904("=DAY(0)")), 1.0); // 1904-01-01
        assert_eq!(n(&eval_1904("=DAY(59)")), 29.0); // 1904-02-29 (real)
    }

    #[test]
    fn round_trip_with_date() {
        assert_eq!(n(&eval("=DAY(DATE(2026,11,23))")), 23.0);
    }
}
