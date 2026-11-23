//! `MODE.MULT(number1, [number2], ...)` — all most-frequently-occurring
//! values as a vertical array. Spec: `docs/functions/MODE.MULT.md`.

use std::collections::HashMap;

use crate::common::coercion;
use calc_core::array::ArrayValue;
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
    let mut freq: HashMap<u64, usize> = HashMap::new();
    let mut order: Vec<f64> = Vec::new();
    for x in nums {
        let count = freq.entry(x.to_bits()).or_insert_with(|| {
            order.push(x);
            0
        });
        *count += 1;
    }
    let max_f = order.iter().map(|x| freq[&x.to_bits()]).max().unwrap_or(0);
    if max_f < 2 {
        return Ok(Value::Error(CalcError::NA));
    }
    // Modes in order of first appearance (SPEC-OPEN in MODE.MULT.md:
    // first-appearance vs sorted — matches MODE.SNGL's tie rule).
    let cells: Vec<Value> = order
        .iter()
        .filter(|x| freq[&x.to_bits()] == max_f)
        .map(|x| Value::Number(*x))
        .collect();
    match ArrayValue::from_column(cells) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> Vec<f64> {
        match v {
            Value::Array(a) => a
                .iter()
                .map(|c| match c {
                    Value::Number(n) => *n,
                    o => panic!("expected number cell, got {o:?}"),
                })
                .collect(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn two_modes() {
        assert_eq!(arr(&eval("=MODE.MULT(1,2,2,3,3,4)")), vec![2.0, 3.0]);
    }

    #[test]
    fn first_appearance_order() {
        assert_eq!(arr(&eval("=MODE.MULT(3,3,1,2,2)")), vec![3.0, 2.0]);
    }

    #[test]
    fn single_mode() {
        assert_eq!(arr(&eval("=MODE.MULT(1,1,2,3)")), vec![1.0]);
    }

    #[test]
    fn all_distinct_na() {
        assert_eq!(e(&eval("=MODE.MULT(1,2,3)")), CalcError::NA);
    }

    #[test]
    fn single_value_na() {
        assert_eq!(e(&eval("=MODE.MULT(5)")), CalcError::NA);
    }

    #[test]
    fn vertical_shape() {
        match eval("=MODE.MULT(1,1,2,2)") {
            Value::Array(a) => assert_eq!((a.rows(), a.cols()), (2, 1)),
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn range_ignores_non_numeric() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", "2".into()),
                ("A3", 2.0.into()),
                ("A4", 9.0.into()),
                ("A5", 9.0.into()),
            ],
            "=MODE.MULT(A1:A6)",
        );
        assert_eq!(arr(&v), vec![2.0, 9.0]);
    }

    #[test]
    fn scalar_text_coerces() {
        assert_eq!(arr(&eval("=MODE.MULT(1,1,\"3\",\"3\")")), vec![1.0, 3.0]);
    }

    #[test]
    fn scalar_bad_text_value() {
        assert_eq!(e(&eval("=MODE.MULT(1,1,\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MODE.MULT(1,1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn all_text_range_na() {
        let v = eval_with(
            &[("A1", "a".into()), ("A2", "b".into())],
            "=MODE.MULT(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=MODE.MULT()")), CalcError::Value);
    }
}
