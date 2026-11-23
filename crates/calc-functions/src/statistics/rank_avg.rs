//! `RANK.AVG(number, ref, [order])` — rank of `number` among the
//! numeric values of `ref`; ties get the average of their positions.
//! Spec: `docs/functions/RANK.AVG.md`.
//!
//! `order` 0/omitted -> descending; nonzero -> ascending. `number`
//! absent from `ref` is `#N/A` (same membership rule as `RANK.EQ`).

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let number = match statistics::scalar_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let nums = match coercion::collect_numbers(ctx, &args[1..2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let order = match args.get(2) {
        None => 0.0,
        Some(a) => match statistics::scalar_number(ctx, a)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(o) => o,
        },
    };
    if !nums.contains(&number) {
        return Ok(Value::Error(CalcError::NA));
    }
    let (better, ties) = nums.iter().fold((0usize, 0usize), |(b, t), &v| {
        let dominated = if order == 0.0 { v > number } else { v < number };
        (b + dominated as usize, t + (v == number) as usize)
    });
    Ok(Value::Number(
        better as f64 + 1.0 + (ties as f64 - 1.0) / 2.0,
    ))
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
            ("A1", 9.0.into()),
            ("A2", 8.0.into()),
            ("A3", 7.0.into()),
            ("A4", 7.0.into()),
            ("A5", 6.0.into()),
        ]
    }

    #[test]
    fn ties_get_average_rank() {
        // Two 7s occupy ranks 3 and 4 -> 3.5.
        assert_eq!(n(&eval_with(&cells(), "=RANK.AVG(7,A1:A5)")), 3.5);
    }

    #[test]
    fn no_tie_descending() {
        assert_eq!(n(&eval_with(&cells(), "=RANK.AVG(6,A1:A5)")), 5.0);
    }

    #[test]
    fn top_value_rank_one() {
        assert_eq!(n(&eval_with(&cells(), "=RANK.AVG(9,A1:A5)")), 1.0);
    }

    #[test]
    fn ascending_order() {
        // {1,2,3} ascending: 2 -> rank 2.
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=RANK.AVG(2,A1:A3,1)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn ascending_ties_average() {
        // ascending: three 3s at positions 2,3,4 -> avg 3.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 3.0.into()),
                ("A3", 3.0.into()),
                ("A4", 3.0.into()),
                ("A5", 9.0.into()),
            ],
            "=RANK.AVG(3,A1:A5,1)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn absent_number_na() {
        assert_eq!(
            e(&eval_with(&cells(), "=RANK.AVG(10,A1:A5)")),
            CalcError::NA
        );
    }

    #[test]
    fn empty_ref_na() {
        let v = eval_with(&[("A1", "x".into())], "=RANK.AVG(4,A1:A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn number_text_coerces() {
        assert_eq!(n(&eval_with(&cells(), r#"=RANK.AVG("7",A1:A5)"#)), 3.5);
    }

    #[test]
    fn number_bad_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells(), r#"=RANK.AVG("x",A1:A5)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn ref_ignores_non_numeric() {
        // {"x",TRUE,5,2}: numerics {5,2}; rank of 5 desc = 1.
        let v = eval_with(
            &[
                ("A1", "x".into()),
                ("A2", Value::Boolean(true)),
                ("A4", 5.0.into()),
                ("A5", 2.0.into()),
            ],
            "=RANK.AVG(5,A1:A5)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn boolean_order_is_ascending() {
        let v = eval_with(&cells(), "=RANK.AVG(9,A1:A5,TRUE)");
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn error_in_ref_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero)), ("A2", 1.0.into())],
            "=RANK.AVG(1,A1:A2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }
}
