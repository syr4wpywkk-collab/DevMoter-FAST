//! `SKEW(number1, [number2], ...)` — sample skewness (n-adjusted
//! Fisher–Pearson coefficient `G1`). Spec: `docs/functions/SKEW.md`.
//!
//! `G1 = n/((n-1)(n-2)) · Σ((x - x̄)/s)³` with `s` the *sample* sd.
//! `n < 3` or `s = 0` -> `#DIV/0!`.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let n = nums.len();
    if n < 3 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let var = statistics::sample_variance(&nums).unwrap_or(0.0);
    if var == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let s = var.sqrt();
    let mean = nums.iter().sum::<f64>() / n as f64;
    let m3 = nums
        .iter()
        .map(|x| {
            let z = (x - mean) / s;
            z * z * z
        })
        .sum::<f64>();
    let g1 = n as f64 / ((n - 1) as f64 * (n - 2) as f64) * m3;
    Ok(Value::Number(g1))
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
        // {3;4;5;2;3;4;5;6;4;7} -> 0.359543.
        let v = n(&eval("=SKEW(3,4,5,2,3,4,5,6,4,7)"));
        assert!((v - 0.359543).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn symmetric_gives_zero() {
        assert_eq!(n(&eval("=SKEW(1,1,2,2,3,3)")), 0.0);
    }

    #[test]
    fn right_skewed_positive() {
        assert!(n(&eval("=SKEW(1,1,1,1,1,2,3,10)")) > 0.0);
    }

    #[test]
    fn left_skewed_negative() {
        assert!(n(&eval("=SKEW(10,9,9,9,9,8,7,1)")) < 0.0);
    }

    #[test]
    fn two_values_div_zero() {
        assert_eq!(e(&eval("=SKEW(1,2)")), CalcError::DivZero);
    }

    #[test]
    fn identical_values_div_zero() {
        assert_eq!(e(&eval("=SKEW(5,5,5,5)")), CalcError::DivZero);
    }

    #[test]
    fn no_numeric_div_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=SKEW(A1:A4)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        // Numerics {3,4,5,2,3,4,5,6,4,7} plus ignored cells.
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 4.0.into()),
                ("A3", 5.0.into()),
                ("A4", 2.0.into()),
                ("A5", "skip".into()),
                ("A6", Value::Boolean(true)),
                ("B1", 3.0.into()),
                ("B2", 4.0.into()),
                ("B3", 5.0.into()),
                ("B4", 6.0.into()),
                ("B5", 4.0.into()),
                ("B6", 7.0.into()),
            ],
            "=SKEW(A1:A6,B1:B6)",
        );
        assert!((n(&v) - 0.359543).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn direct_numeric_text_coerces() {
        // {"1",2,3,4,10} all coerce/count.
        let v = n(&eval(r#"=SKEW("1",2,3,4,10)"#));
        assert!(v.is_finite());
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=SKEW("abc",1,2,3)"#)), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=SKEW(A1:A4)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
