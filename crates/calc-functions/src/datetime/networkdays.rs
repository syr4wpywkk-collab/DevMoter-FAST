//! `NETWORKDAYS(start_date, end_date, [holidays])` — count of whole
//! working days (Mon–Fri) between two dates inclusive, excluding
//! holidays. Spec: `docs/functions/NETWORKDAYS.md`.
//!
//! `start > end` returns the negated forward count (Excel documented
//! behavior). Holidays are collected via
//! [`crate::common::date_text::collect_holidays`]: sorted and deduped,
//! range members contribute numbers only, weekend holidays are
//! naturally ignored by the workday test.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_text;
use crate::datetime::workday;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
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
    let holidays = match workday::holidays_arg(ctx, args.get(2))? {
        Ok(h) => h,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(Value::Number(
        workday::count_workdays(start, end, &workday::DEFAULT_WEEKEND, &holidays) as f64,
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
        // 45288 = 2023-12-28 Thu, 45294 = 2024-01-03 Wed: Dec 28, 29,
        // Jan 1, 2, 3 -> 5.
        assert_eq!(n(&eval("=NETWORKDAYS(45288,45294)")), 5.0);
        // Holiday Jan 1 (45292) -> 4.
        assert_eq!(n(&eval("=NETWORKDAYS(45288,45294,45292)")), 4.0);
        // Reversed arguments negate.
        assert_eq!(n(&eval("=NETWORKDAYS(45294,45288)")), -5.0);
    }

    #[test]
    fn full_week_span() {
        // Mon 2024-01-01 (45292) .. Sun 2024-01-07 (45298) -> 5.
        assert_eq!(n(&eval("=NETWORKDAYS(45292,45298)")), 5.0);
        // Single weekend day -> 0; single weekday -> 1.
        assert_eq!(n(&eval("=NETWORKDAYS(45297,45297)")), 0.0);
        assert_eq!(n(&eval("=NETWORKDAYS(45296,45296)")), 1.0);
    }

    #[test]
    fn weekend_holidays_ignored() {
        // Dec 31 Sunday as holiday changes nothing.
        assert_eq!(n(&eval("=NETWORKDAYS(45288,45294,45291)")), 5.0);
    }

    #[test]
    fn duplicate_holidays_dedupe() {
        let v = eval_with(
            &[
                ("A1", Value::Number(45292.0)),
                ("A2", Value::Number(45292.0)),
            ],
            "=NETWORKDAYS(45288,45294,A1:A2)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn holiday_range_ignores_non_numbers() {
        let v = eval_with(
            &[
                ("A1", Value::Number(45292.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Blank),
            ],
            "=NETWORKDAYS(45288,45294,A1:A3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn text_dates_parse() {
        assert_eq!(n(&eval("=NETWORKDAYS(\"2023-12-28\",\"2024-01-03\")")), 5.0);
    }

    #[test]
    fn fractional_serials_truncate() {
        assert_eq!(n(&eval("=NETWORKDAYS(45288.9,45294.9)")), 5.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=NETWORKDAYS(\"x\",45294)")), CalcError::Value);
        assert_eq!(e(&eval("=NETWORKDAYS(TRUE,45294)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=NETWORKDAYS(-1,45294)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=NETWORKDAYS(1/0,45294)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=NETWORKDAYS(1)")), CalcError::Value);
        assert_eq!(e(&eval("=NETWORKDAYS(1,2,3,4)")), CalcError::Value);
    }
}
