//! `NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])` —
//! `NETWORKDAYS` with a configurable weekend definition.
//! Spec: `docs/functions/NETWORKDAYS.INTL.md`.
//!
//! `weekend` (default `1` = Sat+Sun): numeric codes `1..=7`/`11..=17`
//! or a 7-character `'0'`/`'1'` Monday..Sunday mask, parsed by
//! [`crate::common::date_text::weekend_mask`]. An invalid code or mask
//! is `#VALUE!`. An all-weekend mask (`"1111111"`) is `#VALUE!`
//! (SPEC-OPEN: whether Excel errors or returns 0 — erroring is the
//! safe interpretation; `WORKDAY.INTL` treats it as `#NUM!`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_text;
use crate::datetime::workday;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 4) {
        return Ok(Value::Error(e));
    }
    let start = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let end = match date_text::eval_date(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let weekend = match args.get(2) {
        None | Some(Expr::Missing) => workday::DEFAULT_WEEKEND,
        Some(e) => match date_text::weekend_mask(&ctx.eval(e)?) {
            Ok(m) => m,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    if weekend.iter().all(|w| *w) {
        return Ok(Value::Error(CalcError::Value));
    }
    let holidays = match workday::holidays_arg(ctx, args.get(3))? {
        Ok(h) => h,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(Value::Number(
        workday::count_workdays(start, end, &weekend, &holidays) as f64,
    ))
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
        // Same as NETWORKDAYS: 2023-12-28 .. 2024-01-03 -> 5.
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45288,45294)")), 5.0);
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45288,45294,1)")), 5.0);
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45288,45294,1,45292)")), 4.0);
        assert_eq!(
            e(&eval("=NETWORKDAYS.INTL(45288,45294,99)")),
            CalcError::Value
        );
    }

    #[test]
    fn fri_sat_weekend() {
        // Code 7: Fri+Sat weekend. 2023-12-28 Thu .. 2024-01-03 Wed:
        // workdays Dec 28, 31, Jan 1, 2, 3 -> 5.
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45288,45294,7)")), 5.0);
        // Same span as a mask string (Mon..Sun, Fri+Sat = "0000110").
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45288,45294,\"0000110\")")), 5.0);
        // Sunday-only weekend (code 11): only Dec 30 excluded -> 6.
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45288,45294,11)")), 6.0);
    }

    #[test]
    fn single_day_weekend_codes() {
        // Code 12 = Monday only: over Mon Jan 1 .. Sun Jan 7, only
        // Jan 1 excluded -> 6.
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45292,45298,12)")), 6.0);
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45292,45298,17)")), 6.0);
    }

    #[test]
    fn reversed_args_negate() {
        assert_eq!(n(&eval("=NETWORKDAYS.INTL(45294,45288,1)")), -5.0);
    }

    #[test]
    fn invalid_weekend_is_value() {
        assert_eq!(
            e(&eval("=NETWORKDAYS.INTL(45288,45294,\"1111111\")")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval("=NETWORKDAYS.INTL(45288,45294,\"00000\")")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval("=NETWORKDAYS.INTL(45288,45294,\"00000x0\")")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval("=NETWORKDAYS.INTL(45288,45294,8)")),
            CalcError::Value
        );
    }

    #[test]
    fn text_dates_parse() {
        assert_eq!(
            n(&eval("=NETWORKDAYS.INTL(\"2023-12-28\",\"2024-01-03\",1)")),
            5.0
        );
    }

    #[test]
    fn holidays_from_range() {
        let v = eval_with(
            &[("A1", Value::Number(45292.0))],
            "=NETWORKDAYS.INTL(45288,45294,1,A1)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=NETWORKDAYS.INTL(\"x\",45294)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=NETWORKDAYS.INTL(-1,45294)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=NETWORKDAYS.INTL(1/0,45294)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=NETWORKDAYS.INTL(1)")), CalcError::Value);
        assert_eq!(e(&eval("=NETWORKDAYS.INTL(1,2,1,1,1)")), CalcError::Value);
    }
}
