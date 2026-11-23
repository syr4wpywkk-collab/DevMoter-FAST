//! `QUARTILE.EXC(array, quart)` — quartile by the exclusive method,
//! equivalent to `PERCENTILE.EXC(array, quart/4)`. Spec:
//! `docs/functions/QUARTILE.EXC.md`.
//!
//! `quart` is truncated to an integer and must land in `{1,2,3}`
//! (unlike `.INC`, `0`/`4` are `#NUM!`). Small arrays that leave the
//! exclusive rank outside `[1, n]` are also `#NUM!`.

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
    if nums.is_empty() || !(1.0..=3.0).contains(&quart) {
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    match statistics::percentile_exc_sorted(&nums, quart / 4.0) {
        Some(v) => Ok(Value::Number(v)),
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

    fn cells() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
        ]
    }

    #[test]
    fn quart_one() {
        // {1,2,3,4}: r = 0.25*5 = 1.25 -> 1.25.
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,1)")), 1.25);
    }

    #[test]
    fn quart_two_is_median() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,2)")), 2.5);
    }

    #[test]
    fn quart_three() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,3)")), 3.75);
    }

    #[test]
    fn doc_example_eleven_values() {
        // {1..11}, quart 1 -> 3, quart 3 -> 9.
        let inputs: Vec<(String, Value)> = (1..=11)
            .map(|i| (format!("A{i}"), Value::Number(i as f64)))
            .collect();
        let refs: Vec<(&str, Value)> = inputs
            .iter()
            .map(|(a, v)| (a.as_str(), v.clone()))
            .collect();
        assert_eq!(n(&eval_with(&refs, "=QUARTILE.EXC(A1:A11,1)")), 3.0);
        assert_eq!(n(&eval_with(&refs, "=QUARTILE.EXC(A1:A11,3)")), 9.0);
    }

    #[test]
    fn quart_zero_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn quart_four_num_error() {
        // 4 is legal for QUARTILE.INC but not .EXC.
        assert_eq!(
            e(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,4)")),
            CalcError::Num
        );
    }

    #[test]
    fn quart_out_of_range_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,-1)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,5)")),
            CalcError::Num
        );
    }

    #[test]
    fn quart_truncated() {
        assert_eq!(n(&eval_with(&cells(), "=QUARTILE.EXC(A1:A4,1.9)")), 1.25);
    }

    #[test]
    fn too_small_array_num_error() {
        // n=2: r = 0.25*3 = 0.75 < 1 -> #NUM!.
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into())],
            "=QUARTILE.EXC(A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn empty_numeric_set_num_error() {
        let v = eval_with(&[("A1", "x".into())], "=QUARTILE.EXC(A1:A1,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn quart_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells(), r#"=QUARTILE.EXC(A1:A4,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=QUARTILE.EXC(A1:A2,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
