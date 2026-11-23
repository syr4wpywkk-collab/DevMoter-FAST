//! `ISOWEEKNUM(date)` — ISO 8601 week number (1–53) of a date serial.
//! Spec: `docs/functions/ISOWEEKNUM.md`.
//!
//! Weeks start Monday and week 1 contains the year's first Thursday:
//! shift the date to the Thursday of its week, then the week number is
//! `(thursday - jan1_of_that_year)/7 + 1`. Equivalent to
//! `WEEKNUM(date, 21)` — the shared kernel lives in
//! [`crate::datetime::weeknum::iso_week`].

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_text;
use crate::datetime::weeknum;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let serial = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    match weeknum::iso_week(serial, ctx.date_system()) {
        Some(w) => Ok(Value::Number(w as f64)),
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
    fn spec_examples() {
        assert_eq!(n(&eval("=ISOWEEKNUM(45291)")), 52.0); // 2023-12-31 Sun
        assert_eq!(n(&eval("=ISOWEEKNUM(45292)")), 1.0); // 2024-01-01 Mon
        assert_eq!(n(&eval("=ISOWEEKNUM(44197)")), 53.0); // 2021-01-01 Fri
        assert_eq!(n(&eval("=ISOWEEKNUM(45658)")), 1.0); // 2025-01-01 Wed
        assert_eq!(e(&eval("=ISOWEEKNUM(-1)")), CalcError::Num);
    }

    #[test]
    fn iso_year_boundary() {
        // 2019-12-30/31 are ISO week 1 of 2020.
        assert_eq!(n(&eval("=ISOWEEKNUM(43829)")), 1.0); // 2019-12-30 Mon
        assert_eq!(n(&eval("=ISOWEEKNUM(43828)")), 52.0); // 2019-12-29 Sun
        // 2020-12-28..2021-01-03 are ISO week 53 of 2020.
        assert_eq!(n(&eval("=ISOWEEKNUM(44195)")), 53.0); // 2020-12-30 Wed
        assert_eq!(n(&eval("=ISOWEEKNUM(44199)")), 53.0); // 2021-01-03 Sun
        assert_eq!(n(&eval("=ISOWEEKNUM(44200)")), 1.0); // 2021-01-04 Mon
    }

    #[test]
    fn text_date_parses() {
        assert_eq!(n(&eval("=ISOWEEKNUM(\"2024-01-01\")")), 1.0);
    }

    #[test]
    fn fractional_serial_truncates() {
        assert_eq!(n(&eval("=ISOWEEKNUM(45292.9)")), 1.0);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=ISOWEEKNUM(3000000)")), CalcError::Num);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=ISOWEEKNUM(\"nope\")")), CalcError::Value);
        assert_eq!(e(&eval("=ISOWEEKNUM(TRUE)")), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=ISOWEEKNUM(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn cell_ref_coerces() {
        let v = eval_with(&[("A1", Value::Number(45658.0))], "=ISOWEEKNUM(A1)");
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=ISOWEEKNUM()")), CalcError::Value);
        assert_eq!(e(&eval("=ISOWEEKNUM(1,2)")), CalcError::Value);
    }
}
