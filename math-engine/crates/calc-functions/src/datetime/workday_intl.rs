//! `WORKDAY.INTL(start_date, days, [weekend], [holidays])` —
//! `WORKDAY` with a configurable weekend definition.
//! Spec: `docs/functions/WORKDAY.INTL.md`.
//!
//! `weekend` uses the same encoding as `NETWORKDAYS.INTL` (numeric
//! codes or a 7-char Monday..Sunday mask — see
//! [`crate::common::date_text::weekend_mask`]); invalid specifiers are
//! `#VALUE!`. An all-weekend mask would step forever, so it is `#NUM!`
//! (SPEC-OPEN: Excel's exact error class for `"1111111"` is
//! unconfirmed — erroring is the required engine behavior either way).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::{coercion, date_serial, date_text};
use crate::datetime::workday;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 4) {
        return Ok(Value::Error(e));
    }
    let start = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let days = match coercion::eval_number(ctx, &args[1])? {
        Ok(v) => date_serial::trunc_to_i64(v),
        Err(e) => return Ok(Value::Error(e)),
    };
    let weekend = match args.get(2) {
        None | Some(Expr::Missing) => workday::DEFAULT_WEEKEND,
        Some(e) => match date_text::weekend_mask(&ctx.eval(e)?) {
            Ok(m) => m,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    // A mask with no workdays can never satisfy a nonzero step count —
    // and `days = 0` short-circuits in the kernel anyway. Report #NUM!
    // rather than walk to the end of the calendar.
    if days != 0 && weekend.iter().all(|w| *w) {
        return Ok(Value::Error(CalcError::Num));
    }
    let holidays = match workday::holidays_arg(ctx, args.get(3))? {
        Ok(h) => h,
        Err(e) => return Ok(Value::Error(e)),
    };
    match workday::step_workdays(start, days, &weekend, &holidays, ctx.date_system()) {
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
    fn spec_examples() {
        // Default weekend = Sat/Sun: same as WORKDAY.
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,5)")), 45295.0);
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,5,1)")), 45295.0);
        assert_eq!(e(&eval("=WORKDAY.INTL(45288,5,99)")), CalcError::Value);
    }

    #[test]
    fn fri_sat_weekend() {
        // Code 7: from Thu Dec 28, 5 workdays skipping Fri+Sat:
        // Dec 31, Jan 1-3, Jan 4 wait — Fri Jan 5 is weekend. Steps:
        // Dec 31(1), Jan 1(2), Jan 2(3), Jan 3(4), Jan 4(5) -> 45295.
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,5,7)")), 45295.0);
        // Mask string equivalent.
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,5,\"0000110\")")), 45295.0);
        // 3 workdays: Dec 31, Jan 1, Jan 2 -> 45293.
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,3,\"0000110\")")), 45293.0);
    }

    #[test]
    fn sunday_only_weekend() {
        // Code 11: only Sundays off. From Thu Dec 28: Dec 29, 30,
        // Jan 1, 2, 3 -> 45294.
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,5,11)")), 45294.0);
    }

    #[test]
    fn backward_with_intl_weekend() {
        // Code 7 from Jan 3 Wed back 3: Jan 2, Jan 1, Dec 31 -> 45291.
        assert_eq!(n(&eval("=WORKDAY.INTL(45294,-3,7)")), 45291.0);
    }

    #[test]
    fn holidays_skip() {
        assert_eq!(n(&eval("=WORKDAY.INTL(45288,5,1,45293)")), 45296.0);
    }

    #[test]
    fn all_weekend_mask_is_num() {
        assert_eq!(
            e(&eval("=WORKDAY.INTL(45288,5,\"1111111\")")),
            CalcError::Num
        );
    }

    #[test]
    fn invalid_weekend_is_value() {
        assert_eq!(
            e(&eval("=WORKDAY.INTL(45288,5,\"00000\")")),
            CalcError::Value
        );
        assert_eq!(e(&eval("=WORKDAY.INTL(45288,5,8)")), CalcError::Value);
    }

    #[test]
    fn days_zero_returns_start() {
        assert_eq!(n(&eval("=WORKDAY.INTL(45297,0,7)")), 45297.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=WORKDAY.INTL(\"x\",5)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=WORKDAY.INTL(-1,5)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=WORKDAY.INTL(1/0,5)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=WORKDAY.INTL(1)")), CalcError::Value);
        assert_eq!(e(&eval("=WORKDAY.INTL(1,2,1,1,1)")), CalcError::Value);
    }
}
