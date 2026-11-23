//! `EDATE(start_date, months)` — serial of the date `months` months
//! before/after `start_date`. Spec: `docs/functions/EDATE.md`.
//!
//! `start_date` is a date serial (direct coercion; fractional part
//! truncated — the result never carries a time component). `months`
//! truncates toward zero; negative moves backward. The day-of-month is
//! clamped to the target month's last day rather than rolling over:
//! `EDATE(2024-01-31, 1)` = 2024-02-29. Month arithmetic uses the
//! bug-compat calendar, so February 1900 has 29 days under the 1900
//! system.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;

/// Shared body for `EDATE`/`EOMONTH`: evaluate the two arguments,
/// return `(start_serial, months, system)` or the `CalcError` to emit.
pub(crate) fn eval_args(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<(i64, i64, calc_core::workbook::DateSystem), CalcError>, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Err(e));
    }
    let start = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    let months = match ctx.eval(&args[1])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    if start < 0.0 {
        return Ok(Err(CalcError::Num));
    }
    let serial = date_serial::trunc_to_i64(start);
    if serial > date_serial::max_serial(ctx.date_system()) {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok((
        serial,
        date_serial::trunc_to_i64(months),
        ctx.date_system(),
    )))
}

/// Shift `(year, month, day)` by `months` calendar months, clamping the
/// day to the target month's length. `None` when out of domain.
pub(crate) fn shift_months(
    year: i64,
    month: u32,
    day: u32,
    months: i64,
    system: calc_core::workbook::DateSystem,
) -> Option<i64> {
    let total = year
        .checked_mul(12)?
        .checked_add(month as i64 - 1)?
        .checked_add(months)?;
    let ny = total.div_euclid(12);
    let nm = total.rem_euclid(12) as u32 + 1;
    let nd = day.min(date_serial::days_in_month(ny, nm, system)).max(1);
    date_serial::date_to_serial(ny, nm, nd as i64, system)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (serial, months, system) = match eval_args(ctx, args)? {
        Ok(t) => t,
        Err(e) => return Ok(Value::Error(e)),
    };
    // serial is in-domain, so serial_to_date cannot fail.
    let (y, m, d) = date_serial::serial_to_date(serial, system).unwrap();
    match shift_months(y, m, d, months, system) {
        Some(s) => Ok(Value::Number(s as f64)),
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
    fn basic_forward() {
        // EDATE(2023-03-15, 1) = 2023-04-15 = 45031.
        assert_eq!(n(&eval("=EDATE(45000,1)")), 45031.0);
    }

    #[test]
    fn months_zero_same_date() {
        assert_eq!(n(&eval("=EDATE(45000,0)")), 45000.0);
    }

    #[test]
    fn month_end_clamps() {
        // 2026-01-31 + 1 month -> 2026-02-28 (non-leap).
        assert_eq!(n(&eval("=EDATE(DATE(2026,1,31),1)")), 46081.0);
        // Leap year: 2024-01-31 + 1 -> 2024-02-29.
        assert_eq!(n(&eval("=EDATE(DATE(2024,1,31),1)")), 45351.0);
    }

    #[test]
    fn leap_day_plus_year() {
        // 2024-02-29 + 12 months -> 2025-02-28.
        assert_eq!(n(&eval("=EDATE(DATE(2024,2,29),12)")), 45716.0);
    }

    #[test]
    fn negative_months() {
        // 2026-01-31 - 1 month -> 2025-12-31.
        assert_eq!(n(&eval("=EDATE(DATE(2026,1,31),-1)")), 46022.0);
        assert_eq!(
            n(&eval("=EDATE(DATE(2026,3,15),-13)")),
            n(&eval("=DATE(2025,2,15)"))
        );
    }

    #[test]
    fn fraction_truncated() {
        assert_eq!(n(&eval("=EDATE(45000.9,0)")), 45000.0);
        assert_eq!(n(&eval("=EDATE(45000,1.9)")), 45031.0);
        assert_eq!(n(&eval("=EDATE(45000,-1.9)")), n(&eval("=EDATE(45000,-1)")));
    }

    #[test]
    fn start_serial_zero() {
        // 1900-01-00 + 1 month -> clamps day 0 up to 1: 1900-02-01 = 32.
        assert_eq!(n(&eval("=EDATE(0,1)")), 32.0);
    }

    #[test]
    fn negative_start_num() {
        assert_eq!(e(&eval("=EDATE(-1,1)")), CalcError::Num);
        assert_eq!(e(&eval("=EDATE(-0.5,1)")), CalcError::Num);
    }

    #[test]
    fn out_of_domain_result_num() {
        assert_eq!(e(&eval("=EDATE(2958465,1)")), CalcError::Num);
        assert_eq!(e(&eval("=EDATE(1,-13)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=EDATE("45000","1")"#)), 45031.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=EDATE("x",1)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=EDATE(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn blank_months_is_zero() {
        assert_eq!(n(&eval("=EDATE(45000,)")), 45000.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=EDATE(1)")), CalcError::Value);
        assert_eq!(e(&eval("=EDATE(1,2,3)")), CalcError::Value);
    }
}
