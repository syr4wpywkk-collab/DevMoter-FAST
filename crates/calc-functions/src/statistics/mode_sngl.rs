//! `MODE.SNGL(number1, [number2], ...)` — the most frequently occurring
//! numeric value; the first-encountered value wins frequency ties.
//! Spec: `docs/functions/MODE.SNGL.md`.
//!
//! No repeated value (or an empty numeric set) is `#N/A`.

use std::collections::HashMap;

use crate::common::coercion;
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
    // Frequency per exact f64 value (bit-keyed); `order` records the
    // first-encountered sequence for tie-breaking.
    let mut freq: HashMap<u64, usize> = HashMap::new();
    let mut order: Vec<f64> = Vec::new();
    for x in nums {
        let key = x.to_bits();
        let count = freq.entry(key).or_insert_with(|| {
            order.push(x);
            0
        });
        *count += 1;
    }
    // `max_by_key` keeps the LAST maximum; the spec needs the first-
    // encountered winner, so scan `order` (first-seen order) manually.
    let mut best: Option<f64> = None;
    for &x in &order {
        let f = freq[&x.to_bits()];
        if f > 1 && best.is_none_or(|b| f > freq[&b.to_bits()]) {
            best = Some(x);
        }
    }
    match best {
        Some(x) => Ok(Value::Number(x)),
        None => Ok(Value::Error(CalcError::NA)),
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

    #[test]
    fn basic_mode() {
        assert_eq!(n(&eval("=MODE.SNGL(1,2,2,3)")), 2.0);
    }

    #[test]
    fn tie_first_encountered() {
        // 2 and 3 both appear twice; 2 seen first.
        assert_eq!(n(&eval("=MODE.SNGL(1,2,2,3,3)")), 2.0);
    }

    #[test]
    fn tie_first_encountered_reversed() {
        assert_eq!(n(&eval("=MODE.SNGL(3,3,1,2,2)")), 3.0);
    }

    #[test]
    fn all_distinct_na() {
        assert_eq!(e(&eval("=MODE.SNGL(1,2,3)")), CalcError::NA);
    }

    #[test]
    fn single_value_na() {
        assert_eq!(e(&eval("=MODE.SNGL(5)")), CalcError::NA);
    }

    #[test]
    fn range_mode() {
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 4.0.into()), ("A3", 7.0.into())],
            "=MODE.SNGL(A1:A3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        // numerics {2,2,9}; text "2" and TRUE don't count.
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", "2".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 2.0.into()),
                ("A5", 9.0.into()),
            ],
            "=MODE.SNGL(A1:A6)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=MODE.SNGL("2",2,9)"#)), 2.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MODE.SNGL("abc")"#)), CalcError::Value);
    }

    #[test]
    fn negatives() {
        assert_eq!(n(&eval("=MODE.SNGL(-3,-3,1,1,-3)")), -3.0);
    }

    #[test]
    fn empty_numeric_set_na() {
        let v = eval_with(&[("A1", "x".into())], "=MODE.SNGL(A1:A2)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 2.0.into())],
            "=MODE.SNGL(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
