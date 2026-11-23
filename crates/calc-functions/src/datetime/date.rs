//! `DATE(year, month, day)` — serial for a calendar date with
//! Excel-style normalization of out-of-range arguments.
//! Spec: `docs/functions/DATE.md`.
//!
//! Each argument coerces per direct-scalar rules and truncates toward
//! zero. `month` outside `1..=12` rolls over years, then `day` offsets
//! linearly from the normalized first of month — so the fictitious
//! `1900-02-29` is reachable as `DATE(1900,2,29)` → serial 60.
//!
//! `year` rule (per system epoch): `0..=1899` is offset by the epoch
//! year (1900 or 1904), `>= epoch..=9999` is used as-is, negative or
//! `>= 10000` is `#NUM!`. SPEC-OPEN: the exact 1904-system offset
//! window (Excel documents `4..=1899`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use calc_core::workbook::DateSystem;

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
    let [mut year, month, day] = parts;
    let system = ctx.date_system();
    if !(0..10_000).contains(&year) {
        return Ok(Value::Error(CalcError::Num));
    }
    if year <= 1899 {
        year += match system {
            DateSystem::Excel1900 => 1900,
            DateSystem::Excel1904 => 1904,
        };
    }
    match date_serial::normalized_serial(year, month, day, system) {
        Some(s) => Ok(Value::Number(s as f64)),
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
    fn basic_date() {
        assert_eq!(n(&eval("=DATE(2026,1,1)")), 46023.0);
        assert_eq!(n(&eval("=DATE(1970,1,1)")), 25569.0);
        assert_eq!(n(&eval("=DATE(1900,1,1)")), 1.0);
    }

    #[test]
    fn month_overflow_rolls_year() {
        assert_eq!(n(&eval("=DATE(2024,13,1)")), 45658.0); // 2025-01-01
        assert_eq!(n(&eval("=DATE(2024,0,1)")), 45261.0); // 2023-12-01
        assert_eq!(n(&eval("=DATE(2024,-1,1)")), 45231.0); // 2023-11-01
    }

    #[test]
    fn day_overflow_rolls_month() {
        assert_eq!(n(&eval("=DATE(2024,1,32)")), 45323.0); // 2024-02-01
        assert_eq!(n(&eval("=DATE(2024,1,0)")), 45291.0); // 2023-12-31
        assert_eq!(n(&eval("=DATE(2023,2,29)")), 44986.0); // -> 2023-03-01
    }

    #[test]
    fn year_offset_below_1900() {
        assert_eq!(n(&eval("=DATE(24,1,1)")), 8767.0); // 1924-01-01
        assert_eq!(n(&eval("=DATE(0,1,1)")), 1.0); // 1900-01-01
    }

    #[test]
    fn year_out_of_range_num() {
        assert_eq!(e(&eval("=DATE(-1,1,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DATE(10000,1,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DATE(9999,13,1)")), CalcError::Num); // rolls to 10000
    }

    #[test]
    fn result_before_epoch_num() {
        assert_eq!(e(&eval("=DATE(1900,1,-1)")), CalcError::Num);
    }

    #[test]
    fn serial_zero_is_reachable() {
        assert_eq!(n(&eval("=DATE(1900,1,0)")), 0.0);
    }

    #[test]
    fn fictitious_feb_29_1900() {
        assert_eq!(n(&eval("=DATE(1900,2,29)")), 60.0);
        assert_eq!(n(&eval("=DATE(1900,2,30)")), 61.0);
        assert_eq!(n(&eval("=DATE(1900,3,1)")), 61.0);
    }

    #[test]
    fn fractional_args_truncate() {
        assert_eq!(
            n(&eval("=DATE(2024.9,6.9,15.9)")),
            n(&eval("=DATE(2024,6,15)"))
        );
    }

    #[test]
    fn text_numbers_coerce() {
        assert_eq!(
            n(&eval(r#"=DATE("2024","6","15")"#)),
            n(&eval("=DATE(2024,6,15)"))
        );
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=DATE("x",1,1)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DATE(2024,1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn blank_arg_is_zero() {
        assert_eq!(n(&eval("=DATE(2024,1,)")), n(&eval("=DATE(2024,1,0)")));
    }

    #[test]
    fn system_1904_offset_and_domain() {
        assert_eq!(n(&eval_1904("=DATE(1904,1,1)")), 0.0);
        assert_eq!(n(&eval_1904("=DATE(2026,1,1)")), 46023.0 - 1462.0);
        assert_eq!(e(&eval_1904("=DATE(1903,12,31)")), CalcError::Num);
        assert_eq!(e(&eval_1904("=DATE(1904,1,0)")), CalcError::Num);
    }
}
