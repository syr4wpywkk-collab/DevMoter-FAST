//! `YEAR(serial_number)` — year of a date serial, 1900–9999.
//! Spec: `docs/functions/YEAR.md`.
//!
//! Direct-scalar coercion; the fractional part is truncated before
//! conversion under the workbook [`DateSystem`]. Serial 0 reports 1900
//! (the "1900-01-00" quirk), serial 60 reports 1900 (fictitious
//! 1900-02-29). Negative or out-of-domain serials are `#NUM!`.

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
        Some((y, _, _)) => Ok(Value::Number(y as f64)),
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
    fn basic_years() {
        assert_eq!(n(&eval("=YEAR(45000)")), 2023.0);
        assert_eq!(n(&eval("=YEAR(1)")), 1900.0);
        assert_eq!(n(&eval("=YEAR(2958465)")), 9999.0);
    }

    #[test]
    fn fraction_ignored() {
        assert_eq!(n(&eval("=YEAR(45000.999)")), 2023.0);
    }

    #[test]
    fn serial_zero_is_1900() {
        assert_eq!(n(&eval("=YEAR(0)")), 1900.0);
    }

    #[test]
    fn bug_window_serials() {
        assert_eq!(n(&eval("=YEAR(59)")), 1900.0);
        assert_eq!(n(&eval("=YEAR(60)")), 1900.0);
        assert_eq!(n(&eval("=YEAR(61)")), 1900.0);
    }

    #[test]
    fn negative_serial_num() {
        assert_eq!(e(&eval("=YEAR(-1)")), CalcError::Num);
        assert_eq!(e(&eval("=YEAR(-0.5)")), CalcError::Num);
    }

    #[test]
    fn beyond_max_num() {
        assert_eq!(e(&eval("=YEAR(2958466)")), CalcError::Num);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=YEAR("45000")"#)), 2023.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=YEAR("hello")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=YEAR(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_serial_zero() {
        assert_eq!(n(&eval("=YEAR(A1)")), 1900.0);
    }

    #[test]
    fn system_1904() {
        // Serial 0 is 1904-01-01; same serial reads 4 years later-ish.
        assert_eq!(n(&eval_1904("=YEAR(0)")), 1904.0);
        assert_eq!(n(&eval_1904("=YEAR(43538)")), 2023.0);
    }

    #[test]
    fn round_trip_with_date() {
        assert_eq!(n(&eval("=YEAR(DATE(2026,11,23))")), 2026.0);
    }
}
