//! `DATEDIF(start_date, end_date, unit)` — difference between two
//! dates in whole units. Spec: `docs/functions/DATEDIF.md`.
//!
//! `unit` is case-insensitive text: `"Y"` complete years, `"M"`
//! complete calendar months, `"D"` days (serial subtraction), `"YM"`
//! months ignoring years, `"MD"` days ignoring months/years, `"YD"`
//! days ignoring years. An invalid unit is `#NUM!`; `start > end` is
//! `#NUM!`.
//!
//! `"MD"`/`"YD"` are computed as `end - start` advanced by the
//! complete-month/complete-year count (month-end clamped via
//! [`crate::datetime::edate::shift_months`]), i.e. the *mathematically
//! intended* result — Excel's `"MD"` borrow bug (negative results for
//! some day-of-month pairs) is NOT replicated (SPEC-OPEN in
//! `docs/SPEC-OPEN.md`; flagged `specOpen` in the golden fixture).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;
use crate::common::date_text;
use crate::datetime::edate;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
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
    let unit = match ctx.eval(&args[2])?.to_text() {
        Ok(t) => t.trim().to_ascii_uppercase(),
        Err(e) => return Ok(Value::Error(e)),
    };
    if start > end {
        return Ok(Value::Error(CalcError::Num));
    }
    let (y1, m1, d1) = match date_serial::serial_to_date(start, system) {
        Some(t) => t,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let (y2, m2, d2) = match date_serial::serial_to_date(end, system) {
        Some(t) => t,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    // Complete months and complete years (shared primitives for the
    // compound units).
    let months_total = 12 * (y2 - y1) + (m2 as i64 - m1 as i64) - i64::from(d2 < d1);
    let result = match unit.as_str() {
        "D" => end - start,
        "M" => months_total,
        "Y" => months_total / 12,
        "YM" => months_total % 12,
        "MD" => match edate::shift_months(y1, m1, d1, months_total, system) {
            Some(anchor) => end - anchor,
            None => return Ok(Value::Error(CalcError::Num)),
        },
        "YD" => {
            let years = months_total / 12;
            match edate::shift_months(y1, m1, d1, 12 * years, system) {
                Some(anchor) => end - anchor,
                None => return Ok(Value::Error(CalcError::Num)),
            }
        }
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
        // 44197 = 2021-01-01, 45292 = 2024-01-01 (the spec doc's
        // "2023-12-31" parenthetical is off by one day; the serials
        // rule). Exact 3-year span: Y=3, M=36, D=1095.
        assert_eq!(n(&eval("=DATEDIF(44197,45292,\"Y\")")), 3.0);
        assert_eq!(n(&eval("=DATEDIF(44197,45292,\"M\")")), 36.0);
        assert_eq!(n(&eval("=DATEDIF(44197,45292,\"D\")")), 1095.0);
        assert_eq!(e(&eval("=DATEDIF(45292,44197,\"Y\")")), CalcError::Num);
    }

    #[test]
    fn ym_md_yd_units() {
        // 2021-01-01 -> 2023-12-31 (45291): 35 complete months.
        assert_eq!(n(&eval("=DATEDIF(44197,45291,\"YM\")")), 11.0);
        assert_eq!(n(&eval("=DATEDIF(44197,45292,\"YM\")")), 0.0);
        // MD: 35-month anchor at 2023-12-01 leaves 30 days.
        assert_eq!(n(&eval("=DATEDIF(44197,45291,\"MD\")")), 30.0);
        // YD: 2-year anchor at 2023-01-01 leaves 364 days.
        assert_eq!(n(&eval("=DATEDIF(44197,45291,\"YD\")")), 364.0);
        // Leap boundary: 2020-01-01 -> 2021-01-01 is a full year -> 0.
        assert_eq!(n(&eval("=DATEDIF(43831,44197,\"YD\")")), 0.0);
    }

    #[test]
    fn unit_is_case_insensitive() {
        assert_eq!(n(&eval("=DATEDIF(44197,45292,\"y\")")), 3.0);
        assert_eq!(n(&eval("=DATEDIF(44197,45291,\"ym\")")), 11.0);
    }

    #[test]
    fn invalid_unit_is_num() {
        assert_eq!(e(&eval("=DATEDIF(44197,45292,\"X\")")), CalcError::Num);
        assert_eq!(e(&eval("=DATEDIF(44197,45292,\"MM\")")), CalcError::Num);
        assert_eq!(e(&eval("=DATEDIF(44197,45292,\"\")")), CalcError::Num);
    }

    #[test]
    fn text_dates_parse() {
        assert_eq!(
            n(&eval("=DATEDIF(\"2021-01-01\",\"2023-12-31\",\"D\")")),
            1094.0
        );
    }

    #[test]
    fn same_date_is_zero() {
        assert_eq!(n(&eval("=DATEDIF(45000,45000,\"Y\")")), 0.0);
        assert_eq!(n(&eval("=DATEDIF(45000,45000,\"MD\")")), 0.0);
    }

    #[test]
    fn partial_year_boundary() {
        // 2023-06-30 = 45107 -> 2024-06-29 = 45472: day short of a year.
        assert_eq!(n(&eval("=DATEDIF(45107,45472,\"Y\")")), 0.0);
        assert_eq!(n(&eval("=DATEDIF(45107,45473,\"Y\")")), 1.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=DATEDIF(\"x\",45000,\"D\")")), CalcError::Value);
        assert_eq!(e(&eval("=DATEDIF(TRUE,45000,\"D\")")), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=DATEDIF(1/0,45000,\"D\")")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=DATEDIF(1,2)")), CalcError::Value);
    }
}
