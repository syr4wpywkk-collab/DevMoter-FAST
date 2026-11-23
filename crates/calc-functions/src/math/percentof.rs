//! `PERCENTOF(data_subset, data_all)` — `SUM(data_subset) /
//! SUM(data_all)` as a 0-1 ratio (percent display is a formatting
//! concern). Spec: `docs/functions/PERCENTOF.md`.
//!
//! Both arguments follow the SUM-family collection rule: direct scalar
//! args coerce (text `"x"` -> `#VALUE!`); text/boolean/blank inside
//! ranges and array constants are skipped; error cells propagate. A zero
//! denominator is
//! `#DIV/0!` (the spec's primary reading; the alternative `0` is
//! SPEC-OPEN).

use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Sum one argument: ranges and array constants contribute numbers
/// only (text/boolean/blank skipped, errors propagated); any other
/// scalar coerces via `Value::to_number`.
fn sum_arg(ctx: &mut EvalContext<'_>, arg: &Expr) -> Result<Result<f64, CalcError>, EvalError> {
    fn sum_array(a: &ArrayValue) -> Result<f64, CalcError> {
        let mut s = 0.0;
        for v in a.iter() {
            match v {
                Value::Number(n) => s += n,
                Value::Error(e) => return Err(*e),
                _ => {}
            }
        }
        Ok(s)
    }
    Ok(match ctx.eval_arg(arg)? {
        ArgValue::Range(a) => sum_array(&a),
        ArgValue::Scalar(Value::Array(a)) | ArgValue::Ref(Value::Array(a)) => sum_array(&a),
        ArgValue::Scalar(v) | ArgValue::Ref(v) => v.to_number(),
    })
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let sub = match sum_arg(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    let all = match sum_arg(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    if all == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(sub / all))
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
    fn spec_example() {
        assert!((n(&eval("=PERCENTOF({1;2},{1;2;7})")) - 0.3).abs() < 1e-12);
    }

    #[test]
    fn scalar_args() {
        assert_eq!(n(&eval("=PERCENTOF(1,4)")), 0.25);
        assert_eq!(n(&eval("=PERCENTOF(3,3)")), 1.0);
    }

    #[test]
    fn ranges() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 7.0.into()),
            ],
            "=PERCENTOF(A1:A2,B1:B3)",
        );
        assert!((n(&v) - 0.3).abs() < 1e-12);
    }

    #[test]
    fn range_skips_text_blank_bool() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("B1", 2.0.into()),
                ("B2", Value::Boolean(true)),
            ],
            "=PERCENTOF(A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 0.5);
    }

    #[test]
    fn numerator_larger_than_denominator() {
        assert!((n(&eval("=PERCENTOF({1;2;7},{1;2})")) - 10.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn negative_sums() {
        assert_eq!(n(&eval("=PERCENTOF(-1,-4)")), 0.25);
    }

    #[test]
    fn zero_denominator_div_zero() {
        assert_eq!(e(&eval("=PERCENTOF(1,0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=PERCENTOF({1;2},{-1;1})")), CalcError::DivZero);
    }

    #[test]
    fn empty_numerator_is_zero() {
        // Blank range contributes nothing -> numerator 0.
        let v = eval_with(&[("B1", 5.0.into())], "=PERCENTOF(A1:A3,B1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn scalar_text_coerces() {
        assert_eq!(n(&eval(r#"=PERCENTOF("1","4")"#)), 0.25);
    }

    #[test]
    fn scalar_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=PERCENTOF("x",4)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=PERCENTOF(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", Value::Error(CalcError::DivZero))],
            "=PERCENTOF(A1,B1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn scalar_error_propagates() {
        assert_eq!(e(&eval("=PERCENTOF(1/0,4)")), CalcError::DivZero);
        assert_eq!(e(&eval("=PERCENTOF(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=PERCENTOF(1)")), CalcError::Value);
        assert_eq!(e(&eval("=PERCENTOF(1,2,3)")), CalcError::Value);
    }
}
