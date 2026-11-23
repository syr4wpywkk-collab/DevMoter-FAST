//! `DAYS(end_date, start_date)` — days between two dates, end minus
//! start (note the reversed argument order). Spec:
//! `docs/functions/DAYS.md`.
//!
//! Both arguments coerce per the i20 date-argument rules
//! ([`crate::common::date_text`]): numbers are serials, text parses via
//! the fixed date grammar, booleans are `#VALUE!`. Fractional serials
//! truncate to whole days before subtracting, so the result is always
//! an integer; negative results are allowed (no `#NUM!` for
//! end < start).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_text;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let end = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let start = match date_text::eval_date(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(Value::Number((end - start) as f64))
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
        assert_eq!(n(&eval("=DAYS(45292,44197)")), 1095.0);
        assert_eq!(n(&eval("=DAYS(44197,45292)")), -1095.0);
        assert_eq!(n(&eval("=DAYS(45000,45000)")), 0.0);
    }

    #[test]
    fn text_dates_parse() {
        assert_eq!(n(&eval("=DAYS(\"2024-01-01\",\"2021-01-01\")")), 1095.0);
        assert_eq!(n(&eval("=DAYS(\"1/1/2024\",\"1/1/2021\")")), 1095.0);
    }

    #[test]
    fn fractional_serials_truncate() {
        assert_eq!(n(&eval("=DAYS(45000.9,45000.1)")), 0.0);
        assert_eq!(n(&eval("=DAYS(45001.9,45000.1)")), 1.0);
    }

    #[test]
    fn unparseable_text_is_value_error() {
        assert_eq!(e(&eval("=DAYS(\"garbage\",45000)")), CalcError::Value);
        assert_eq!(e(&eval("=DAYS(45000,\"garbage\")")), CalcError::Value);
        // Numeric text is not a date (DATEVALUE-style rule).
        assert_eq!(e(&eval("=DAYS(\"45000\",44000)")), CalcError::Value);
    }

    #[test]
    fn booleans_are_value_error() {
        assert_eq!(e(&eval("=DAYS(TRUE,45000)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=DAYS(-1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=DAYS(3000000,0)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=DAYS(1/0,45000)")), CalcError::DivZero);
    }

    #[test]
    fn cell_refs_coerce() {
        let v = eval_with(
            &[
                ("A1", Value::Number(45292.0)),
                ("A2", Value::Text("2021-01-01".into())),
            ],
            "=DAYS(A1,A2)",
        );
        assert_eq!(n(&v), 1095.0);
    }

    #[test]
    fn blank_is_serial_zero() {
        assert_eq!(n(&eval("=DAYS(45000,)")), 45000.0);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=DAYS(1)")), CalcError::Value);
        assert_eq!(e(&eval("=DAYS(1,2,3)")), CalcError::Value);
    }
}
