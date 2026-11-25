//! `STANDARDIZE(x, mean, standard_dev)` — z-score `(x - mean)/sd`.
//! Spec: `docs/functions/STANDARDIZE.md`.

use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let mut vals = [0.0f64; 3];
    for (i, arg) in args.iter().enumerate() {
        vals[i] = match statistics::scalar_number(ctx, arg)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(n) => n,
        };
    }
    let [x, mean, sd] = vals;
    if sd <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((x - mean) / sd))
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
    fn excel_doc_example() {
        // STANDARDIZE(42,40,1.5) = 1.333333...
        let v = n(&eval("=STANDARDIZE(42,40,1.5)"));
        assert!((v - 4.0 / 3.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn at_mean_is_zero() {
        assert_eq!(n(&eval("=STANDARDIZE(40,40,1.5)")), 0.0);
    }

    #[test]
    fn below_mean_negative() {
        assert_eq!(n(&eval("=STANDARDIZE(38.5,40,1.5)")), -1.0);
    }

    #[test]
    fn zero_sd_num_error() {
        assert_eq!(e(&eval("=STANDARDIZE(10,5,0)")), CalcError::Num);
    }

    #[test]
    fn negative_sd_num_error() {
        assert_eq!(e(&eval("=STANDARDIZE(10,5,-2)")), CalcError::Num);
    }

    #[test]
    fn text_args_coerce() {
        let v = n(&eval(r#"=STANDARDIZE("42","40","1.5")"#));
        assert!((v - 4.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=STANDARDIZE("x",40,1.5)"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        // (TRUE - 0) / 1 = 1.
        assert_eq!(n(&eval("=STANDARDIZE(TRUE,0,1)")), 1.0);
    }

    #[test]
    fn cell_ref_args() {
        let v = eval_with(
            &[("A1", 42.0.into()), ("B1", 40.0.into()), ("C1", 1.5.into())],
            "=STANDARDIZE(A1,B1,C1)",
        );
        assert!((n(&v) - 4.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=STANDARDIZE(1/0,0,1)")), CalcError::DivZero);
    }

    #[test]
    fn negative_result_precision() {
        let v = n(&eval("=STANDARDIZE(1,4,2)"));
        assert_eq!(v, -1.5);
    }
}
