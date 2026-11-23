//! `QUARTILE.INC(array, quart)` — quartile of `array`, equivalent to
//! `PERCENTILE.INC` with `k = quart / 4`. Spec:
//! `docs/functions/QUARTILE.INC.md`.
//!
//! `quart` is an integer 0..=4 (non-integers truncated):
//! 0=min, 1=Q1, 2=median, 3=Q3, 4=max.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let mut nums = match coercion::collect_numbers(ctx, &args[..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let quart = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(q) => q.trunc(),
    };
    if nums.is_empty() || !(0.0..=4.0).contains(&quart) {
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    Ok(Value::Number(statistics::percentile_inc_sorted(
        &nums,
        quart / 4.0,
    )))
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

    fn cells() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
        ]
    }

    #[test]
    fn quart_zero_is_min() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,0)")), 1.0);
    }

    #[test]
    fn quart_one() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,1)")), 1.75);
    }

    #[test]
    fn quart_two_is_median() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,2)")), 2.5);
    }

    #[test]
    fn quart_three() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,3)")), 3.25);
    }

    #[test]
    fn quart_four_is_max() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,4)")), 4.0);
    }

    #[test]
    fn matches_percentile() {
        // QUARTILE.INC(a,q) == PERCENTILE.INC(a,q/4).
        let q = eval_with(&cells(), "=QUARTILE.INC(A1:A4,3)");
        let p = eval_with(&cells(), "=PERCENTILE.INC(A1:A4,0.75)");
        assert_eq!(n(&q), n(&p));
    }

    #[test]
    fn quart_negative_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,-1)")),
            CalcError::Num
        );
    }

    #[test]
    fn quart_above_four_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,5)")),
            CalcError::Num
        );
    }

    #[test]
    fn quart_truncated() {
        // QUARTILE.INC(a,1.9) behaves as quart=1 (see spec open question).
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.INC(A1:A4,1.9)")), 1.75);
    }

    #[test]
    fn empty_numeric_set_num_error() {
        let v = eval_with(&[("A1", "x".into())], "=QUARTILE.INC(A1:A1,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn quart_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells(), r#"=QUARTILE.INC(A1:A4,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn single_value() {
        let v = eval_with(&[("A1", 7.0.into())], "=QUARTILE.INC(A1:A1,2)");
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=QUARTILE.INC(A1:A2,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
