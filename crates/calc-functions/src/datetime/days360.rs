//! `DAYS360(start_date, end_date, [method])` — days between dates on a
//! 360-day year (30-day months). Spec: `docs/functions/DAYS360.md`.
//!
//! `method` (default `FALSE`): `FALSE` = US (NASD) convention, `TRUE` =
//! European. Both kernels live in [`crate::common::finance`]
//! (`days360_us`/`days360_eu`, shared with `YEARFRAC` and the bond
//! functions). Negative results are allowed when `start > end`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::{date_serial, date_text, finance};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let system = ctx.date_system();
    let start = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let end = match date_text::eval_date(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let european = match args.get(2) {
        None | Some(Expr::Missing) => false,
        Some(e) => match ctx.eval(e)?.to_boolean() {
            Ok(b) => b,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    let (d1, d2) = match (
        date_serial::serial_to_date(start, system),
        date_serial::serial_to_date(end, system),
    ) {
        (Some(a), Some(b)) => (a, b),
        _ => return Ok(Value::Error(CalcError::Num)),
    };
    let days = if european {
        finance::days360_eu(d1, d2)
    } else {
        finance::days360_us(d1, d2, system)
    };
    Ok(Value::Number(days as f64))
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
        // 44197 = 2021-01-01, 45292 = 2024-01-01.
        // US: 360*3 + 30*0 + 0 = 1080; EU: same (no 31sts involved).
        assert_eq!(n(&eval("=DAYS360(44197,45292)")), 1080.0);
        assert_eq!(n(&eval("=DAYS360(44197,45292,TRUE)")), 1080.0);
        assert_eq!(n(&eval("=DAYS360(45000,45000)")), 0.0);
        // Excel doc example: DATE(2008,1,30) -> DATE(2008,2,1) = 1.
        assert_eq!(n(&eval("=DAYS360(DATE(2008,1,30),DATE(2008,2,1))")), 1.0);
    }

    #[test]
    fn negative_result_allowed() {
        assert_eq!(n(&eval("=DAYS360(45000,44900)")), -100.0);
    }

    #[test]
    fn thirty_first_adjustment() {
        // Jan 31 -> Feb 1: US clamps d1=30 -> 1 day.
        assert_eq!(n(&eval("=DAYS360(DATE(2024,1,31),DATE(2024,2,1))")), 1.0);
        // Jan 29 -> Jan 31: d1<30 so US rolls d2 to next month's 1st
        // -> 2; EU clamps d2=30 -> 1.
        assert_eq!(n(&eval("=DAYS360(DATE(2024,1,29),DATE(2024,1,31))")), 2.0);
        assert_eq!(
            n(&eval("=DAYS360(DATE(2024,1,29),DATE(2024,1,31),TRUE)")),
            1.0
        );
        // Jan 30 -> Jan 31: start at 30 forces the end 31st to 30 -> 0.
        assert_eq!(n(&eval("=DAYS360(DATE(2024,1,30),DATE(2024,1,31))")), 0.0);
        // Jan 31 -> Mar 31: both clamp -> 60.
        assert_eq!(n(&eval("=DAYS360(DATE(2024,1,31),DATE(2024,3,31))")), 60.0);
    }

    #[test]
    fn february_rule() {
        // Start on Feb's last day counts as day 30 (US): Feb 28 ->
        // Mar 1 = 30*(3-2) + (1-30) = 1.
        assert_eq!(n(&eval("=DAYS360(DATE(2023,2,28),DATE(2023,3,1))")), 1.0);
        // European keeps 28: 30*(3-2) + (1-28) = 3.
        assert_eq!(
            n(&eval("=DAYS360(DATE(2023,2,28),DATE(2023,3,1),TRUE)")),
            3.0
        );
    }

    #[test]
    fn method_truthiness() {
        // Nonzero number behaves as TRUE.
        assert_eq!(n(&eval("=DAYS360(DATE(2024,1,29),DATE(2024,1,31),5)")), 1.0);
        assert_eq!(n(&eval("=DAYS360(DATE(2024,1,29),DATE(2024,1,31),0)")), 2.0);
    }

    #[test]
    fn text_dates_parse() {
        assert_eq!(n(&eval("=DAYS360(\"2021-01-01\",\"2024-01-01\")")), 1080.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=DAYS360(\"x\",45000)")), CalcError::Value);
        assert_eq!(e(&eval("=DAYS360(TRUE,45000)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=DAYS360(-1,45000)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=DAYS360(1/0,45000)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=DAYS360(1)")), CalcError::Value);
        assert_eq!(e(&eval("=DAYS360(1,2,TRUE,4)")), CalcError::Value);
    }
}
