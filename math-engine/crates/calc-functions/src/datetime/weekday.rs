//! `WEEKDAY(serial_number, [return_type])` — day-of-week number of a
//! date serial. Spec: `docs/functions/WEEKDAY.md`.
//!
//! Weekdays come from the linear serial line
//! ([`crate::common::date_text::weekday_mon0`]): `serial % 7` maps
//! 1 → Sunday … 0 → Saturday, which is exactly Excel's internal
//! weekday including the fictitious 1900-02-29 slot.
//!
//! `return_type` table (default `1`):
//! `1`/`17` Sun=1..Sat=7, `2`/`11` Mon=1..Sun=7, `3` Mon=0..Sun=6,
//! `12`..`16` shift the start day Tuesday..Saturday. Any other code is
//! `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::{coercion, date_serial, date_text};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let serial = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let return_type = match coercion::eval_opt_number(ctx, args.get(1), 1.0)? {
        Ok(v) => date_serial::trunc_to_i64(v),
        Err(e) => return Ok(Value::Error(e)),
    };
    let mon0 = date_text::weekday_mon0(serial);
    let result = match return_type {
        1 | 17 => (mon0 + 1) % 7 + 1,                       // Sun=1..Sat=7
        2 | 11 => mon0 + 1,                                 // Mon=1..Sun=7
        3 => mon0,                                          // Mon=0..Sun=6
        t @ 12..=16 => (mon0 - (t - 11)).rem_euclid(7) + 1, // Tue..Sat start
        _ => return Ok(Value::Error(CalcError::Num)),
    };
    Ok(Value::Number(result as f64))
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
        // 45292 = 2024-01-01 Monday.
        assert_eq!(n(&eval("=WEEKDAY(45292)")), 2.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,2)")), 1.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,3)")), 0.0);
        // 45298 = 2024-01-07 Sunday.
        assert_eq!(n(&eval("=WEEKDAY(45298,1)")), 1.0);
        assert_eq!(e(&eval("=WEEKDAY(45292,99)")), CalcError::Num);
    }

    #[test]
    fn extended_return_types() {
        // 45292 Monday: type 12 (Tue=1) -> 7; type 16 (Sat=1) -> 3.
        assert_eq!(n(&eval("=WEEKDAY(45292,12)")), 7.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,13)")), 6.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,14)")), 5.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,15)")), 4.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,16)")), 3.0);
        assert_eq!(n(&eval("=WEEKDAY(45292,17)")), 2.0);
    }

    #[test]
    fn full_week_cycle() {
        // 45292..45298 is Mon..Sun.
        for (i, want) in [2, 3, 4, 5, 6, 7, 1].iter().enumerate() {
            let f = format!("=WEEKDAY({})", 45292 + i);
            assert_eq!(n(&eval(&f)), *want as f64, "{f}");
        }
    }

    #[test]
    fn text_date_parses() {
        assert_eq!(n(&eval("=WEEKDAY(\"2024-01-01\")")), 2.0);
    }

    #[test]
    fn fractional_serial_truncates() {
        assert_eq!(n(&eval("=WEEKDAY(45292.99)")), 2.0);
    }

    #[test]
    fn serial_one_is_sunday() {
        // Excel's internal calendar: serial 1 (1900-01-01) is Sunday.
        assert_eq!(n(&eval("=WEEKDAY(1)")), 1.0);
        assert_eq!(n(&eval("=WEEKDAY(60,2)")), 3.0); // fake day -> Wed
    }

    #[test]
    fn invalid_return_type_is_num() {
        assert_eq!(e(&eval("=WEEKDAY(45292,0)")), CalcError::Num);
        assert_eq!(e(&eval("=WEEKDAY(45292,4)")), CalcError::Num);
        assert_eq!(e(&eval("=WEEKDAY(45292,18)")), CalcError::Num);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=WEEKDAY(-1)")), CalcError::Num);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=WEEKDAY(\"nope\")")), CalcError::Value);
        assert_eq!(e(&eval("=WEEKDAY(TRUE)")), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=WEEKDAY(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=WEEKDAY()")), CalcError::Value);
        assert_eq!(e(&eval("=WEEKDAY(1,1,1)")), CalcError::Value);
    }
}
