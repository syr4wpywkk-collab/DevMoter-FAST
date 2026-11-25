//! `TIMEVALUE(time_text)` — day fraction `[0, 1)` of a time stored as
//! text. Spec: `docs/functions/TIMEVALUE.md`.
//!
//! The argument must be text; parsing uses the fixed grammar in
//! [`crate::common::date_text`]: `H:MM`, `H:MM:SS`, optional `AM`/`PM`,
//! and date+time strings (the date part is validated and discarded).
//! Hours ≥ 24 wrap modulo 24 (SPEC-OPEN: Excel reads `"25:00"` as
//! next-day 1:00).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_text;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval(&args[0])? {
        Value::Text(s) => match date_text::parse_time_text(&s) {
            Some(f) => Ok(Value::Number(f)),
            None => Ok(Value::Error(CalcError::Value)),
        },
        Value::Error(e) => Ok(Value::Error(e)),
        _ => Ok(Value::Error(CalcError::Value)),
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

    fn assert_frac(formula: &str, want: f64) {
        let got = n(&eval(formula));
        assert!((got - want).abs() < 1e-9, "{formula}: {got} != {want}");
    }

    #[test]
    fn spec_examples() {
        assert_frac("=TIMEVALUE(\"12:00 PM\")", 0.5);
        assert_frac("=TIMEVALUE(\"14:30\")", 14.5 / 24.0);
        assert_frac("=TIMEVALUE(\"2:24 AM\")", 0.1);
        assert_frac("=TIMEVALUE(\"2026-01-01 18:00\")", 0.75);
        assert_eq!(e(&eval("=TIMEVALUE(\"noon-ish\")")), CalcError::Value);
    }

    #[test]
    fn seconds_precision() {
        assert_frac("=TIMEVALUE(\"23:59:59\")", 86399.0 / 86400.0);
        assert_frac("=TIMEVALUE(\"0:00:00\")", 0.0);
    }

    #[test]
    fn twelve_hour_edges() {
        assert_frac("=TIMEVALUE(\"12:00 AM\")", 0.0); // midnight
        assert_frac("=TIMEVALUE(\"12:30 pm\")", 12.5 / 24.0);
        assert_frac("=TIMEVALUE(\"11:59 PM\")", (23.0 * 60.0 + 59.0) / 1440.0);
    }

    #[test]
    fn am_pm_requires_1_to_12() {
        assert_eq!(e(&eval("=TIMEVALUE(\"13:00 PM\")")), CalcError::Value);
        assert_eq!(e(&eval("=TIMEVALUE(\"0:30 AM\")")), CalcError::Value);
    }

    #[test]
    fn invalid_components() {
        assert_eq!(e(&eval("=TIMEVALUE(\"10:60\")")), CalcError::Value);
        assert_eq!(e(&eval("=TIMEVALUE(\"10:00:60\")")), CalcError::Value);
        assert_eq!(e(&eval("=TIMEVALUE(\"abc\")")), CalcError::Value);
        assert_eq!(e(&eval("=TIMEVALUE(\"\")")), CalcError::Value);
    }

    #[test]
    fn non_text_args_are_value() {
        assert_eq!(e(&eval("=TIMEVALUE(0.5)")), CalcError::Value);
        assert_eq!(e(&eval("=TIMEVALUE(TRUE)")), CalcError::Value);
    }

    #[test]
    fn hours_wrap_mod_24() {
        // SPEC-OPEN: Excel treats "25:00" as 1:00 of the next day.
        assert_frac("=TIMEVALUE(\"25:00\")", 1.0 / 24.0);
        assert_frac("=TIMEVALUE(\"49:30\")", 1.5 / 24.0);
    }

    #[test]
    fn lowercase_and_no_space_markers() {
        assert_frac("=TIMEVALUE(\"5:00am\")", 5.0 / 24.0);
        assert_frac("=TIMEVALUE(\"5:00 PM\")", 17.0 / 24.0);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=TIMEVALUE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_is_value() {
        let v = eval_with(&[("A1", Value::Blank)], "=TIMEVALUE(A1)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=TIMEVALUE()")), CalcError::Value);
        assert_eq!(e(&eval("=TIMEVALUE(\"a\",\"b\")")), CalcError::Value);
    }
}
