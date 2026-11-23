//! `PERCENTRANK.EXC(array, x, [significance])` — rank of `x` as an
//! exclusive percentage `(rank+1)/(n+1)`. Spec: `docs/functions/PERCENTRANK.EXC.md`.
//!
//! Shares the rank/interpolation/truncation machinery with
//! [`super::percentrank_inc`]; only the percentage base differs.

use crate::common::coercion;
use crate::common::statistics;
use crate::statistics::percentrank_inc::{interpolated_rank, significance, trunc_digits};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let mut nums = match coercion::collect_numbers(ctx, &args[..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let x = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(x) => x,
    };
    let sig = match significance(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::NA));
    }
    nums.sort_by(f64::total_cmp);
    let Some(rank) = interpolated_rank(&nums, x) else {
        return Ok(Value::Error(CalcError::NA));
    };
    let pct = (rank + 1.0) / (nums.len() + 1) as f64;
    Ok(Value::Number(trunc_digits(pct, sig)))
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

    fn cells5() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
            ("A5", 5.0.into()),
        ]
    }

    #[test]
    fn doc_example_midpoint() {
        assert_eq!(n(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,3)")), 0.5);
    }

    #[test]
    fn doc_example_interpolated() {
        // rank 1.5 between 2 and 3 -> (2.5)/6 = 0.4166 -> truncated 0.416.
        assert_eq!(
            n(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,2.5)")),
            0.416
        );
    }

    #[test]
    fn doc_example_min() {
        // rank 0 -> 1/6 = 0.166.
        assert_eq!(n(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,1)")), 0.166);
    }

    #[test]
    fn doc_example_above_max_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=PERCENTRANK.EXC(A1:A3,99)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn below_min_na() {
        assert_eq!(
            e(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,0)")),
            CalcError::NA
        );
    }

    #[test]
    fn max_is_n_over_n1() {
        // rank 4 -> 5/6 = 0.833.
        assert_eq!(n(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,5)")), 0.833);
    }

    #[test]
    fn significance_truncates() {
        // rank 1.5 -> 2.5/6 = 0.41666; sig=2 -> 0.41.
        assert_eq!(
            n(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,2.5,2)")),
            0.41
        );
    }

    #[test]
    fn significance_below_one_num() {
        assert_eq!(
            e(&eval_with(&cells5(), "=PERCENTRANK.EXC(A1:A5,3,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn single_element_equal() {
        let v = eval_with(&[("A1", 7.0.into())], "=PERCENTRANK.EXC(A1:A1,7)");
        assert_eq!(n(&v), 0.5);
    }

    #[test]
    fn empty_set_na() {
        let v = eval_with(&[("A1", "x".into())], "=PERCENTRANK.EXC(A1:A1,1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn x_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells5(), r#"=PERCENTRANK.EXC(A1:A5,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=PERCENTRANK.EXC(A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn duplicate_first_rank() {
        // {1,2,2,4}: first rank of 2 is index 1 -> 2/5 = 0.4.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 2.0.into()),
                ("A4", 4.0.into()),
            ],
            "=PERCENTRANK.EXC(A1:A4,2)",
        );
        assert_eq!(n(&v), 0.4);
    }
}
