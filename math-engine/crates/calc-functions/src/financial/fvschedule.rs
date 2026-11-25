//! `FVSCHEDULE(principal, schedule)` — future value of a principal
//! after applying a series of varying rates.
//! Spec: `docs/functions/FVSCHEDULE.md`.
//!
//! `principal · Π (1 + rateᵢ)`. Inside the schedule range/array,
//! blank cells and text count as rate `0` (documented); error cells
//! propagate. A scalar (non-array) `schedule` coerces via `to_number`,
//! so `FVSCHEDULE(100,"x")` -> `#VALUE!`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let principal = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let mut acc = principal;
    match ctx.eval_arg(&args[1])? {
        ArgValue::Scalar(Value::Array(a)) | ArgValue::Range(a) => {
            // Array literal or range: numbers count, everything else
            // (text/blank/logical) is a 0% rate.
            for cell in a.iter() {
                match cell {
                    Value::Number(n) => acc *= 1.0 + n,
                    Value::Error(e) => return Ok(Value::Error(*e)),
                    _ => {}
                }
            }
        }
        ArgValue::Scalar(v) => match v.to_number() {
            Ok(n) => acc *= 1.0 + n,
            Err(e) => return Ok(Value::Error(e)),
        },
        ArgValue::Ref(v) => match v {
            Value::Number(n) => acc *= 1.0 + n,
            Value::Error(e) => return Ok(Value::Error(e)),
            // Non-numeric cell content -> rate 0 (range-derived rule).
            _ => {}
        },
    }
    Ok(Value::Number(acc))
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
    fn doc_example() {
        let v = eval("=FVSCHEDULE(1,{0.09,0.11,0.1})");
        assert!((n(&v) - 1.33089).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn doc_example_negative_rate() {
        let v = eval("=FVSCHEDULE(100,{0.05,-0.02})");
        assert!((n(&v) - 102.9).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn zero_rate_entries() {
        let v = eval("=FVSCHEDULE(100,{0.05,0,0.05})");
        assert!((n(&v) - 110.25).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn range_text_and_blank_are_zero() {
        // A2 blank, A3 text: both rate 0.
        let v = eval_with(
            &[("A1", 0.1.into()), ("A3", "x".into()), ("A4", 0.1.into())],
            "=FVSCHEDULE(100,A1:A4)",
        );
        assert!((n(&v) - 121.0).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn range_error_propagates() {
        let v = eval_with(
            &[("A1", 0.1.into()), ("A2", Value::Error(CalcError::NA))],
            "=FVSCHEDULE(100,A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn scalar_schedule() {
        assert!((n(&eval("=FVSCHEDULE(100,0.1)")) - 110.0).abs() < 1e-9);
    }

    #[test]
    fn scalar_text_schedule_value_error() {
        assert_eq!(e(&eval(r#"=FVSCHEDULE(100,"x")"#)), CalcError::Value);
    }

    #[test]
    fn scalar_numeric_text_schedule() {
        assert!((n(&eval(r#"=FVSCHEDULE(100,"0.1")"#)) - 110.0).abs() < 1e-9);
    }

    #[test]
    fn bad_principal_value_error() {
        assert_eq!(e(&eval(r#"=FVSCHEDULE("x",{0.1})"#)), CalcError::Value);
    }

    #[test]
    fn principal_error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=FVSCHEDULE(A1,{0.1})",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn negative_principal() {
        let v = eval("=FVSCHEDULE(-100,{0.1,0.1})");
        assert!((n(&v) - -121.0).abs() < 1e-9);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FVSCHEDULE(100)")), CalcError::Value);
    }
}
