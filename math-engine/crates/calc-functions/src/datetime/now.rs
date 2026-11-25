//! `NOW()` — current date and time as a serial (integer = date,
//! fraction = time of day). Spec: `docs/functions/NOW.md`.
//!
//! Reads the injected [`Clock`](calc_core::eval::Clock), never the OS
//! clock; session timezone is UTC (SPEC-OPEN: timezone policy).
//! Whole-second precision — sub-second fractions are truncated to the
//! second the injected clock reports (the `Clock` trait is
//! second-granular).
//!
//! Volatility: same gap as `TODAY` — the registry has no volatile
//! marking yet, so stored `=NOW()` cells refresh only when dirty.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 0) {
        return Ok(Value::Error(e));
    }
    match date_serial::unix_to_serial(ctx.clock().unix_seconds(), ctx.date_system()) {
        Some((day, frac)) => Ok(Value::Number(day as f64 + frac)),
        None => Ok(Value::Error(CalcError::Num)),
    }
}

#[cfg(test)]
mod tests {
    use calc_core::workbook::DateSystem;
    use calc_core::{CalcEngine, CalcError, FixedClock, Value};

    fn eval_at(unix: i64, formula: &str) -> Value {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.set_clock(Box::new(FixedClock(unix)));
        e.add_sheet("Sheet1").unwrap();
        e.eval_formula("Sheet1", formula).unwrap()
    }

    fn eval_at_1904(unix: i64, formula: &str) -> Value {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.set_clock(Box::new(FixedClock(unix)));
        e.add_sheet("Sheet1").unwrap();
        e.workbook_mut().set_date_system(DateSystem::Excel1904);
        e.eval_formula("Sheet1", formula).unwrap()
    }

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
    fn unix_epoch_is_25569() {
        assert_eq!(n(&eval_at(0, "=NOW()")), 25569.0);
    }

    #[test]
    fn noon_is_half() {
        assert_eq!(n(&eval_at(43_200, "=NOW()")), 25569.5);
    }

    #[test]
    fn fixed_clock_datetime() {
        // 2026-07-14 03:33:20 UTC = 46217 + 12800/86400.
        let v = n(&eval_at(1_784_000_000, "=NOW()"));
        assert!((v - (46217.0 + 12_800.0 / 86_400.0)).abs() < 1e-9);
    }

    #[test]
    fn shares_date_with_today() {
        let now = n(&eval_at(1_784_000_000, "=NOW()"));
        let today = n(&eval_at(1_784_000_000, "=TODAY()"));
        assert_eq!(now.floor(), today);
    }

    #[test]
    fn midnight_has_no_fraction() {
        assert_eq!(n(&eval_at(1_784_073_600, "=NOW()")), 46218.0);
    }

    #[test]
    fn end_of_day_fraction() {
        let v = n(&eval_at(1_784_073_599, "=NOW()"));
        assert!((v - (46217.0 + 86_399.0 / 86_400.0)).abs() < 1e-9);
    }

    #[test]
    fn system_1904() {
        let v = n(&eval_at_1904(1_784_000_000, "=NOW()"));
        assert!((v - (44755.0 + 12_800.0 / 86_400.0)).abs() < 1e-9);
    }

    #[test]
    fn argument_is_arity_error() {
        assert_eq!(e(&eval_at(0, "=NOW(0)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_num() {
        assert_eq!(e(&eval_at(i64::MAX, "=NOW()")), CalcError::Num);
    }

    #[test]
    fn extracts_time_parts() {
        assert_eq!(n(&eval_at(1_784_000_000, "=HOUR(NOW())")), 3.0);
        assert_eq!(n(&eval_at(1_784_000_000, "=MINUTE(NOW())")), 33.0);
        assert_eq!(n(&eval_at(1_784_000_000, "=SECOND(NOW())")), 20.0);
    }

    #[test]
    fn composes_with_date_time() {
        assert_eq!(n(&eval_at(0, "=NOW()-TODAY()")), 0.0);
    }
}
