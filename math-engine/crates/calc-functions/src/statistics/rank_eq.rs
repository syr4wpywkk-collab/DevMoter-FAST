//! `RANK.EQ(number, ref, [order])` — rank of `number` among the numeric
//! values of `ref`; ties share the best rank. Spec:
//! `docs/functions/RANK.EQ.md`.
//!
//! `order` 0/omitted -> descending (largest is rank 1); nonzero ->
//! ascending. `number` absent from `ref` is `#N/A`; membership uses
//! exact `f64` equality (see spec open question).

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
    let better = nums
        .iter()
        .filter(|&&v| if order == 0.0 { v > number } else { v < number })
        .count();
    Ok(Value::Number(better as f64 + 1.0))
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
            ("A1", 7.0.into()),
            ("A2", 3.0.into()),
            ("A3", 3.0.into()),
            ("A4", 1.0.into()),
            ("A5", 9.0.into()),
        ]
    }

    #[test]
    fn descending_default() {
        // 7 in {7,3,3,1,9}: only 9 is larger -> rank 2.
        assert_eq!(n(&eval_with(&cells(), "=RANK.EQ(7,A1:A5)")), 2.0);
    }

    #[test]
    fn descending_order_zero() {
        assert_eq!(n(&eval_with(&cells(), "=RANK.EQ(7,A1:A5,0)")), 2.0);
    }

    #[test]
    fn ascending_order() {
        // ascending: two values (1,3,3 = three values) below 7 -> rank 4.
        assert_eq!(n(&eval_with(&cells(), "=RANK.EQ(7,A1:A5,1)")), 4.0);
    }

    #[test]
    fn ties_share_best_rank() {
        // both 3s: one value below (1) descending? descending: 7,9 above -> rank 3.
        assert_eq!(n(&eval_with(&cells(), "=RANK.EQ(3,A1:A5)")), 3.0);
    }

    #[test]
    fn top_value_rank_one() {
        assert_eq!(n(&eval_with(&cells(), "=RANK.EQ(9,A1:A5)")), 1.0);
    }

    #[test]
    fn absent_number_na() {
        assert_eq!(e(&eval_with(&cells(), "=RANK.EQ(4,A1:A5)")), CalcError::NA);
    }

    #[test]
    fn empty_ref_na() {
        let v = eval_with(&[("A1", "x".into())], "=RANK.EQ(4,A1:A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn number_text_coerces() {
        assert_eq!(n(&eval_with(&cells(), r#"=RANK.EQ("7",A1:A5)"#)), 2.0);
    }

    #[test]
    fn number_bad_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells(), r#"=RANK.EQ("x",A1:A5)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn ref_ignores_text_bool_blank() {
        // {"x",TRUE,blank,5,2}: numerics {5,2}; rank of 5 desc = 1.
        let v = eval_with(
            &[
                ("A1", "x".into()),
                ("A2", Value::Boolean(true)),
                ("A4", 5.0.into()),
                ("A5", 2.0.into()),
            ],
            "=RANK.EQ(5,A1:A5)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn number_from_cell() {
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("A2", 20.0.into()),
                ("B1", 20.0.into()),
            ],
            "=RANK.EQ(B1,A1:A2)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_in_ref_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero)), ("A2", 1.0.into())],
            "=RANK.EQ(1,A1:A2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }
}
