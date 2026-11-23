//! `TODAY()` — the current date as an integer serial, no arguments.
//! Spec: `docs/functions/TODAY.md`.
//!
//! Reads the injected [`Clock`](calc_core::eval::Clock) from the
//! evaluation context — never the system clock — so tests and
//! reproducible recalculation can pin it. Session timezone is UTC
//! (SPEC-OPEN: workbook/caller timezone policy).
//!
//! Volatility: `TODAY` must re-evaluate every recalculation pass per
//! plan §5, but `FunctionRegistry` currently exposes no volatile
//! marking, so a stored `=TODAY()` cell refreshes only when dirty.
//! Gap recorded in SPEC-OPEN / PR notes.

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
        Some((day, _)) => Ok(Value::Number(day as f64)),
        None => Ok(Value::Error(CalcError::Num)),
    }
}

#[cfg(test)]
mod tests {
    use calc_core::workbook::DateSystem;
    use calc_core::{CalcEngine, CalcError, CellInput, FixedClock, Value};

    /// Evaluate `formula` with the clock pinned at `unix` seconds.
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
    fn unix_epoch_is_serial_25569() {
        assert_eq!(n(&eval_at(0, "=TODAY()")), 25569.0);
    }

    #[test]
    fn fixed_clock_date() {
        // 2026-07-14 03:33:20 UTC -> serial 46217, time ignored.
        assert_eq!(n(&eval_at(1_784_000_000, "=TODAY()")), 46217.0);
    }

    #[test]
    fn integer_result() {
        let v = n(&eval_at(1_784_000_000, "=TODAY()"));
        assert_eq!(v.fract(), 0.0);
    }

    #[test]
    fn same_day_during_whole_day() {
        // Any instant of 2026-07-14 UTC maps to the same serial.
        assert_eq!(n(&eval_at(1_783_987_200, "=TODAY()")), 46217.0); // 00:00
        assert_eq!(n(&eval_at(1_784_073_599, "=TODAY()")), 46217.0); // 23:59:59
    }

    #[test]
    fn midnight_rolls_to_next_serial() {
        assert_eq!(n(&eval_at(1_784_073_600, "=TODAY()")), 46218.0);
    }

    #[test]
    fn system_1904_shifts_by_1462() {
        assert_eq!(
            n(&eval_at_1904(1_784_000_000, "=TODAY()")),
            46217.0 - 1462.0
        );
    }

    #[test]
    fn argument_is_arity_error() {
        assert_eq!(e(&eval_at(0, "=TODAY(1)")), CalcError::Value);
    }

    #[test]
    fn negative_clock_out_of_domain() {
        assert_eq!(e(&eval_at(i64::MIN, "=TODAY()")), CalcError::Num);
    }

    #[test]
    fn usable_in_arithmetic() {
        assert_eq!(n(&eval_at(0, "=TODAY()+1")), 25570.0);
    }

    #[test]
    fn usable_as_date_part() {
        assert_eq!(n(&eval_at(0, "=YEAR(TODAY())")), 1970.0);
        assert_eq!(n(&eval_at(0, "=MONTH(TODAY())")), 1.0);
        assert_eq!(n(&eval_at(0, "=DAY(TODAY())")), 1.0);
    }

    #[test]
    fn ignores_cell_values() {
        // No inputs; blank refs do not affect arity.
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.set_clock(Box::new(FixedClock(0)));
        e.add_sheet("Sheet1").unwrap();
        e.set_cell("Sheet1", "A1", CellInput::Value(Value::Number(5.0)))
            .unwrap();
        assert_eq!(
            e.eval_formula("Sheet1", "=TODAY()").unwrap(),
            Value::Number(25569.0)
        );
    }
}
