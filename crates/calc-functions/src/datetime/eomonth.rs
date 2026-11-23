//! `EOMONTH(start_date, months)` — serial of the last day of the month
//! `months` months before/after `start_date`.
//! Spec: `docs/functions/EOMONTH.md`.
//!
//! Same argument handling as [`edate`]: the start serial's fraction is
//! truncated, `months` truncates toward zero, and the result is an
//! integer serial. The target month is shifted first, then snapped to
//! its last day — `EOMONTH(2026-01-15, 0)` = 2026-01-31.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;
use crate::datetime::edate;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let (serial, months, system) = match edate::eval_args(ctx, args)? {
        Ok(t) => t,
        Err(e) => return Ok(Value::Error(e)),
    };
    let (y, m, _) = date_serial::serial_to_date(serial, system).unwrap();
    // Shift months, then take the last day of the target month.
    let total = y
        .checked_mul(12)
        .and_then(|t| t.checked_add(m as i64 - 1))
        .and_then(|t| t.checked_add(months));
    let Some(total) = total else {
        return Ok(Value::Error(CalcError::Num));
    };
    let ny = total.div_euclid(12);
    let nm = total.rem_euclid(12) as u32 + 1;
    let nd = date_serial::days_in_month(ny, nm, system);
    match date_serial::date_to_serial(ny, nm, nd as i64, system) {
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
    fn snaps_to_month_end() {
        // EOMONTH(2026-01-15, 0) = 2026-01-31 = 46053.
        assert_eq!(n(&eval("=EOMONTH(DATE(2026,1,15),0)")), 46053.0);
        // Already at month end stays.
        assert_eq!(n(&eval("=EOMONTH(DATE(2026,1,31),0)")), 46053.0);
    }

    #[test]
    fn leap_february() {
        assert_eq!(n(&eval("=EOMONTH(DATE(2024,2,10),0)")), 45351.0); // 2024-02-29
        assert_eq!(n(&eval("=EOMONTH(DATE(2025,2,10),0)")), 45716.0); // 2025-02-28
    }

    #[test]
    fn forward_and_backward() {
        assert_eq!(n(&eval("=EOMONTH(DATE(2026,1,15),1)")), 46081.0); // 2026-02-28
        assert_eq!(n(&eval("=EOMONTH(DATE(2026,1,31),-1)")), 46022.0); // 2025-12-31
        assert_eq!(
            n(&eval("=EOMONTH(DATE(2026,3,15),-13)")),
            n(&eval("=DATE(2025,2,28)"))
        );
    }

    #[test]
    fn bug_window_feb_1900() {
        // Under bug compat, Feb 1900 has 29 days: EOMONTH of any
        // Feb-1900 serial is the fictitious 1900-02-29 (serial 60).
        assert_eq!(n(&eval("=EOMONTH(32,0)")), 60.0);
    }

    #[test]
    fn fraction_truncated() {
        assert_eq!(n(&eval("=EOMONTH(45000.9,0)")), 45016.0); // 2023-03-31
        assert_eq!(n(&eval("=EOMONTH(45000,1.9)")), 45046.0); // 2023-04-30
    }

    #[test]
    fn months_zero_from_serial() {
        assert_eq!(n(&eval("=EOMONTH(45000,0)")), 45016.0);
    }

    #[test]
    fn negative_start_num() {
        assert_eq!(e(&eval("=EOMONTH(-1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=EOMONTH(-0.5,0)")), CalcError::Num);
    }

    #[test]
    fn out_of_domain_result_num() {
        assert_eq!(e(&eval("=EOMONTH(2958465,1)")), CalcError::Num);
        assert_eq!(e(&eval("=EOMONTH(1,-13)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=EOMONTH("45000","0")"#)), 45016.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=EOMONTH("x",0)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=EOMONTH(1/0,0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_months_is_zero() {
        assert_eq!(n(&eval("=EOMONTH(45000,)")), 45016.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=EOMONTH(1)")), CalcError::Value);
        assert_eq!(e(&eval("=EOMONTH(1,2,3)")), CalcError::Value);
    }

    #[test]
    fn serial_zero_start() {
        // 1900-01-00 -> EOMONTH(..,0) = 1900-01-31 = 31.
        assert_eq!(n(&eval("=EOMONTH(0,0)")), 31.0);
    }
}
