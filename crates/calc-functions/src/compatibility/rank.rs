//! `RANK(number, ref, [order])` — legacy rank of `number` within
//! `ref`; ties share the best rank and leave gaps.
//! Spec: `docs/functions/RANK.md`.
//!
//! Identical to `RANK.EQ`: `order` 0/omitted -> descending (largest
//! is rank 1); nonzero -> ascending. `number` absent from `ref` is
//! `#N/A`; membership uses exact `f64` equality (the floating-point
//! matching question is spec-open).

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

    #[test]
    fn doc_example_ascending() {
        // Excel doc: RANK(7,{7,3.5,3.5,1,2},1) = 5.
        assert_eq!(n(&eval("=RANK(7,{7,3.5,3.5,1,2},1)")), 5.0);
    }

    #[test]
    fn doc_example_descending() {
        assert_eq!(n(&eval("=RANK(2,{7,3.5,3.5,1,2},0)")), 4.0);
    }

    #[test]
    fn ties_share_top_rank() {
        // 3.5 ties at rank 2; next distinct value ranks 4.
        assert_eq!(n(&eval("=RANK(3.5,{7,3.5,3.5,1,2},0)")), 2.0);
        assert_eq!(n(&eval("=RANK(1,{7,3.5,3.5,1,2},0)")), 5.0);
    }

    #[test]
    fn order_omitted_is_descending() {
        assert_eq!(n(&eval("=RANK(7,{7,3.5,3.5,1,2})")), 1.0);
    }

    #[test]
    fn nonzero_order_is_ascending() {
        assert_eq!(n(&eval("=RANK(1,{7,3.5,3.5,1,2},2)")), 1.0);
        assert_eq!(n(&eval("=RANK(1,{7,3.5,3.5,1,2},-5)")), 1.0);
    }

    #[test]
    fn absent_number_na() {
        assert_eq!(e(&eval("=RANK(6,{1,2,3})")), CalcError::NA);
    }

    #[test]
    fn matches_rank_eq() {
        assert_eq!(
            n(&eval("=RANK(3.5,{7,3.5,3.5,1,2},0)")),
            n(&eval("=RANK.EQ(3.5,{7,3.5,3.5,1,2},0)"))
        );
    }

    #[test]
    fn non_numeric_number_value() {
        assert_eq!(e(&eval("=RANK(\"x\",{1,2,3})")), CalcError::Value);
    }

    #[test]
    fn numeric_text_number_coerces() {
        assert_eq!(n(&eval("=RANK(\"2\",{1,2,3},1)")), 2.0);
    }

    #[test]
    fn range_ignores_text_and_blanks() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(3.0)),
            ],
            "=RANK(3,A1:A3,0)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_in_ref_propagates() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Error(CalcError::DivZero)),
            ],
            "=RANK(1,A1:A2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn single_element() {
        assert_eq!(n(&eval("=RANK(4,{4})")), 1.0);
    }
}
