//! `WORKDAY(start_date, days, [holidays])` — serial of the date `days`
//! working days (Mon–Fri, excluding holidays) before/after
//! `start_date`. Spec: `docs/functions/WORKDAY.md`.
//!
//! The stepping kernel ([`step_workdays`]) and the workday counter
//! ([`count_workdays`], shared with `NETWORKDAYS`) are parameterized on
//! a Monday-indexed weekend mask so the `.INTL` variants reuse them.
//!
//! `days` truncates toward zero; `days = 0` returns `start_date`
//! unchanged even when it is not itself a workday (SPEC-OPEN: Excel's
//! documented offset semantics are ambiguous here). Stepping is bounded
//! by the serial domain — running out of calendar is `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use calc_core::workbook::DateSystem;

use crate::common::{date_serial, date_text};

/// Whether `serial` is a workday: its weekday's weekend flag is clear
/// and it is not in the (sorted, deduped) `holidays` list.
fn is_workday(serial: i64, weekend: &[bool; 7], holidays: &[i64]) -> bool {
    !weekend[date_text::weekday_mon0(serial) as usize] && holidays.binary_search(&serial).is_err()
}

/// Count workdays in the inclusive range `[start, end]`; negative when
/// `start > end` (the negated forward count, per Excel).
pub(crate) fn count_workdays(start: i64, end: i64, weekend: &[bool; 7], holidays: &[i64]) -> i64 {
    let (lo, hi, sign) = if start <= end {
        (start, end, 1i64)
    } else {
        (end, start, -1i64)
    };
    let mut count = 0i64;
    for s in lo..=hi {
        if is_workday(s, weekend, holidays) {
            count += 1;
        }
    }
    sign * count
}

/// Serial `days` workdays after `start` (negative = before). `days = 0`
/// returns `start` unchanged. Returns `None` when stepping would leave
/// the serial domain — including an all-weekend mask, which can never
/// land on a workday for `days != 0`.
pub(crate) fn step_workdays(
    start: i64,
    days: i64,
    weekend: &[bool; 7],
    holidays: &[i64],
    system: DateSystem,
) -> Option<i64> {
    let max = date_serial::max_serial(system);
    let mut s = start;
    let mut remaining = days;
    while remaining != 0 {
        let step = remaining.signum();
        s = s.checked_add(step)?;
        if s < 0 || s > max {
            return None;
        }
        if is_workday(s, weekend, holidays) {
            remaining -= step;
        }
    }
    Some(s)
}

/// Evaluate the optional `holidays` argument (`args.get(idx)`);
/// missing/`Expr::Missing` yields an empty list.
pub(crate) fn holidays_arg(
    ctx: &mut EvalContext<'_>,
    arg: Option<&Expr>,
) -> Result<Result<Vec<i64>, CalcError>, EvalError> {
    match arg {
        None | Some(Expr::Missing) => Ok(Ok(Vec::new())),
        Some(e) => date_text::collect_holidays(ctx, e),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let start = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let days = match crate::common::coercion::eval_number(ctx, &args[1])? {
        Ok(v) => date_serial::trunc_to_i64(v),
        Err(e) => return Ok(Value::Error(e)),
    };
    let holidays = match holidays_arg(ctx, args.get(2))? {
        Ok(h) => h,
        Err(e) => return Ok(Value::Error(e)),
    };
    match step_workdays(start, days, &DEFAULT_WEEKEND, &holidays, ctx.date_system()) {
        Some(s) => Ok(Value::Number(s as f64)),
        None => Ok(Value::Error(CalcError::Num)),
    }
}

/// Weekend mask for plain `WORKDAY`/`NETWORKDAYS` (code 1: Sat+Sun).
pub(crate) const DEFAULT_WEEKEND: [bool; 7] = [false, false, false, false, false, true, true];

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
    fn forward_and_backward() {
        // 45288 = 2023-12-28 Thu. +5 workdays: Dec 29, Jan 1-4 ->
        // 45295 (2024-01-04).
        assert_eq!(n(&eval("=WORKDAY(45288,5)")), 45295.0);
        // 45294 = 2024-01-03 Wed, -3 workdays: Jan 2, Jan 1, Dec 29 ->
        // 45289 (2023-12-29).
        assert_eq!(n(&eval("=WORKDAY(45294,-3)")), 45289.0);
        assert_eq!(n(&eval("=WORKDAY(45288,0)")), 45288.0);
    }

    #[test]
    fn excel_doc_example() {
        // Microsoft doc example: 2008-10-01 + 151 workdays excluding
        // 2008-11-26, 2008-12-04, 2009-01-21 -> 2009-05-05.
        let v = eval_with(
            &[
                ("A1", Value::Number(39778.0)), // 2008-11-26
                ("A2", Value::Number(39786.0)), // 2008-12-04
                ("A3", Value::Number(39833.0)), // 2009-01-21
            ],
            "=WORKDAY(DATE(2008,10,1),151,A1:A3)-DATE(2009,5,5)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn holidays_skip() {
        // Jan 2 (45293) as holiday pushes the +5 result to Jan 5.
        assert_eq!(n(&eval("=WORKDAY(45288,5,45293)")), 45296.0);
        // Weekend holidays are irrelevant: Dec 31 (45291) is Sunday.
        assert_eq!(n(&eval("=WORKDAY(45288,5,45291)")), 45295.0);
    }

    #[test]
    fn holidays_from_range() {
        let v = eval_with(&[("A1", Value::Number(45293.0))], "=WORKDAY(45288,5,A1)");
        assert_eq!(n(&v), 45296.0);
    }

    #[test]
    fn holiday_range_ignores_text_and_blanks() {
        let v = eval_with(
            &[
                ("A1", Value::Number(45293.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Blank),
            ],
            "=WORKDAY(45288,5,A1:A3)",
        );
        assert_eq!(n(&v), 45296.0);
    }

    #[test]
    fn days_truncates() {
        assert_eq!(n(&eval("=WORKDAY(45288,5.9)")), 45295.0);
    }

    #[test]
    fn text_dates_parse() {
        // 2023-12-27 Wed +5 -> 2024-01-03 (45294).
        assert_eq!(n(&eval("=WORKDAY(\"2023-12-27\",5)")), 45294.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=WORKDAY(\"x\",5)")), CalcError::Value);
        assert_eq!(e(&eval("=WORKDAY(TRUE,5)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=WORKDAY(-1,5)")), CalcError::Num);
        // Stepping past the end of the calendar.
        assert_eq!(e(&eval("=WORKDAY(2958465,5)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=WORKDAY(1/0,5)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=WORKDAY(1)")), CalcError::Value);
        assert_eq!(e(&eval("=WORKDAY(1,2,3,4)")), CalcError::Value);
    }
}
