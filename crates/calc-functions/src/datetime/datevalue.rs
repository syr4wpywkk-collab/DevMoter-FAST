//! `DATEVALUE(date_text)` — serial of a date stored as text.
//! Spec: `docs/functions/DATEVALUE.md`.
//!
//! The argument must be text (a number, boolean, or blank is
//! `#VALUE!`); parsing uses the fixed grammar in
//! [`crate::common::date_text`] — ISO and common en-US forms, a
//! 2029/2030 two-digit-year pivot, optional trailing time (discarded).
//! Unparseable or out-of-domain text is `#VALUE!`.

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
    let v = ctx.eval(&args[0])?;
    match v {
        Value::Text(s) => match date_text::parse_date_text(&s, ctx.date_system()) {
            Some(serial) => Ok(Value::Number(serial as f64)),
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

    #[test]
    fn spec_examples() {
        assert_eq!(n(&eval("=DATEVALUE(\"2026-01-01\")")), 46023.0);
        assert_eq!(n(&eval("=DATEVALUE(\"1/1/2026\")")), 46023.0);
        assert_eq!(n(&eval("=DATEVALUE(\"31-Dec-2025\")")), 46022.0);
        assert_eq!(e(&eval("=DATEVALUE(\"2/30/2026\")")), CalcError::Value);
        assert_eq!(e(&eval("=DATEVALUE(\"nonsense\")")), CalcError::Value);
    }

    #[test]
    fn long_month_names() {
        assert_eq!(n(&eval("=DATEVALUE(\"December 31, 2025\")")), 46022.0);
        assert_eq!(n(&eval("=DATEVALUE(\"Dec 31 2025\")")), 46022.0);
    }

    #[test]
    fn two_digit_year_pivot() {
        // 29 -> 2029, 30 -> 1930.
        assert_eq!(
            n(&eval("=DATEVALUE(\"1/1/29\")")),
            n(&eval("=DATEVALUE(\"1/1/2029\")"))
        );
        assert_eq!(
            n(&eval("=DATEVALUE(\"1/1/30\")")),
            n(&eval("=DATEVALUE(\"1/1/1930\")"))
        );
    }

    #[test]
    fn trailing_time_is_discarded() {
        assert_eq!(n(&eval("=DATEVALUE(\"2026-01-01 15:00\")")), 46023.0);
    }

    #[test]
    fn numeric_text_rejected() {
        assert_eq!(e(&eval("=DATEVALUE(\"45000\")")), CalcError::Value);
    }

    #[test]
    fn non_text_args_are_value() {
        assert_eq!(e(&eval("=DATEVALUE(45000)")), CalcError::Value);
        assert_eq!(e(&eval("=DATEVALUE(TRUE)")), CalcError::Value);
        assert_eq!(e(&eval("=DATEVALUE(2026-1-1)")), CalcError::Value);
    }

    #[test]
    fn blank_is_value() {
        let v = eval_with(&[("A1", Value::Blank)], "=DATEVALUE(A1)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn invalid_calendar_dates() {
        assert_eq!(e(&eval("=DATEVALUE(\"2023-02-29\")")), CalcError::Value);
        // Leap day parses to the day before 2024-03-01.
        assert_eq!(
            n(&eval("=DATEVALUE(\"2024-02-29\")")),
            n(&eval("=DATEVALUE(\"2024-03-01\")")) - 1.0
        );
        assert_eq!(e(&eval("=DATEVALUE(\"13/1/2026\")")), CalcError::Value);
    }

    #[test]
    fn out_of_domain() {
        assert_eq!(e(&eval("=DATEVALUE(\"1/1/10000\")")), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=DATEVALUE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=DATEVALUE()")), CalcError::Value);
        assert_eq!(e(&eval("=DATEVALUE(\"x\",\"y\")")), CalcError::Value);
    }
}
