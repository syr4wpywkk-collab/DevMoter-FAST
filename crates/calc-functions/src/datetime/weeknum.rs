//! `WEEKNUM(serial_number, [return_type])` — week number of the year.
//! Spec: `docs/functions/WEEKNUM.md`.
//!
//! Two schemes per `return_type` (default `1`):
//!
//! - **Jan-1 week** (`1`, `2`, `11`–`17`): week 1 contains January 1;
//!   the type selects the week-start weekday (`1`/`17` Sunday,
//!   `2`/`11` Monday, `12` Tuesday … `16` Saturday). Computed as
//!   `floor((s - jan1 + shift)/7) + 1` where `shift` is the distance
//!   from the week-start day to January 1's weekday.
//! - **ISO 8601** (`21`): identical to `ISOWEEKNUM` — week 1 contains
//!   the year's first Thursday (see [`crate::datetime::isoweeknum`]).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::{coercion, date_serial, date_text};

/// ISO 8601 week number of an integer serial (week 1 contains the
/// first Thursday; weeks start Monday).
pub(crate) fn iso_week(serial: i64, system: calc_core::workbook::DateSystem) -> Option<i64> {
    let mon0 = date_text::weekday_mon0(serial);
    let thursday = serial - mon0 + 3;
    let (iso_year, _, _) = date_serial::serial_to_date(thursday, system)?;
    let jan1 = date_serial::date_to_serial(iso_year, 1, 1, system)?;
    Some((thursday - jan1) / 7 + 1)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let system = ctx.date_system();
    let serial = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let return_type = match coercion::eval_opt_number(ctx, args.get(1), 1.0)? {
        Ok(v) => date_serial::trunc_to_i64(v),
        Err(e) => return Ok(Value::Error(e)),
    };
    if return_type == 21 {
        return match iso_week(serial, system) {
            Some(w) => Ok(Value::Number(w as f64)),
            None => Ok(Value::Error(CalcError::Num)),
        };
    }
    // Week-start day in Mon0 indexing: 1/17 -> Sunday(6), 2/11 ->
    // Monday(0), 12..16 -> Tuesday(1)..Saturday(5).
    let week_start = match return_type {
        1 | 17 => 6,
        2 | 11 => 0,
        t @ 12..=16 => t - 11,
        _ => return Ok(Value::Error(CalcError::Num)),
    };
    let (year, _, _) = match date_serial::serial_to_date(serial, system) {
        Some(d) => d,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let jan1 = match date_serial::date_to_serial(year, 1, 1, system) {
        Some(s) => s,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let shift = (date_text::weekday_mon0(jan1) - week_start).rem_euclid(7);
    let week = (serial - jan1 + shift) / 7 + 1;
    Ok(Value::Number(week as f64))
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
    fn spec_examples() {
        assert_eq!(n(&eval("=WEEKNUM(45292,1)")), 1.0); // 2024-01-01
        assert_eq!(n(&eval("=WEEKNUM(45298,1)")), 2.0); // first Sunday
        assert_eq!(n(&eval("=WEEKNUM(45292,21)")), 1.0);
        assert_eq!(n(&eval("=WEEKNUM(44197,21)")), 53.0);
        assert_eq!(n(&eval("=WEEKNUM(45291,2)")), 53.0);
        assert_eq!(e(&eval("=WEEKNUM(45292,3)")), CalcError::Num);
    }

    #[test]
    fn default_is_type1() {
        assert_eq!(n(&eval("=WEEKNUM(45298)")), 2.0);
    }

    #[test]
    fn week_start_variants() {
        // 2024-01-02 (Tue): type 12 (Tue start) begins week 2 there.
        assert_eq!(n(&eval("=WEEKNUM(45293,12)")), 2.0);
        assert_eq!(n(&eval("=WEEKNUM(45293,11)")), 1.0);
        // Type 16 (Sat start): first Saturday 2024-01-06 is week 2.
        assert_eq!(n(&eval("=WEEKNUM(45297,16)")), 2.0);
    }

    #[test]
    fn text_date_parses() {
        assert_eq!(n(&eval("=WEEKNUM(\"2024-01-07\")")), 2.0);
    }

    #[test]
    fn fractional_serial_truncates() {
        assert_eq!(n(&eval("=WEEKNUM(45298.9)")), 2.0);
    }

    #[test]
    fn iso_matches_isoweeknum() {
        for s in [44197, 45291, 45292, 45658, 46000] {
            let a = n(&eval(&format!("=WEEKNUM({s},21)")));
            let b = n(&eval(&format!("=ISOWEEKNUM({s})")));
            assert_eq!(a, b, "serial {s}");
        }
    }

    #[test]
    fn invalid_return_type_is_num() {
        for t in [0, 3, 10, 18, 20, 22, 99] {
            assert_eq!(
                e(&eval(&format!("=WEEKNUM(45292,{t})"))),
                CalcError::Num,
                "type {t}"
            );
        }
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=WEEKNUM(-5)")), CalcError::Num);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=WEEKNUM(\"nope\")")), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=WEEKNUM(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=WEEKNUM()")), CalcError::Value);
        assert_eq!(e(&eval("=WEEKNUM(1,1,1)")), CalcError::Value);
    }
}
