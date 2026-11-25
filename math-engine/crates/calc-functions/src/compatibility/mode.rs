//! `MODE(number1, [number2], ...)` — legacy most-frequently-occurring
//! numeric value; the first-encountered value wins frequency ties.
//! Equivalent to `MODE.SNGL`. Spec: `docs/functions/MODE.md`.
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
    // The first-encountered value wins ties, so scan `order` manually.
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
    fn spec_example() {
        assert_eq!(n(&eval("=MODE({5.6,4,4,3,2,4})")), 4.0);
    }

    #[test]
    fn no_repeat_na() {
        assert_eq!(e(&eval("=MODE({1,2,3,4})")), CalcError::NA);
    }

    #[test]
    fn tie_first_encountered() {
        // 1 and 2 both appear twice; 1 seen first.
        assert_eq!(n(&eval("=MODE({1,1,2,2,3})")), 1.0);
    }

    #[test]
    fn scalar_args() {
        assert_eq!(n(&eval("=MODE(1,2,2,3)")), 2.0);
    }

    #[test]
    fn range_arg() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 7.0.into()), ("A3", 7.0.into())],
            "=MODE(A1:A3)",
        );
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn text_in_range_ignored() {
        let v = eval_with(
            &[("A1", "x".into()), ("A2", 7.0.into()), ("A3", 7.0.into())],
            "=MODE(A1:A3)",
        );
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn blank_in_range_ignored() {
        let v = eval_with(&[], "=MODE(A1,{7,7})");
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn direct_text_value() {
        // Direct non-numeric scalar text is a coercion error.
        assert_eq!(e(&eval(r#"=MODE({7,7},"x")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        assert_eq!(n(&eval(r#"=MODE("3","3",1)"#)), 3.0);
    }

    #[test]
    fn empty_numeric_set_na() {
        assert_eq!(e(&eval("=MODE(A1)")), CalcError::NA);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=MODE(A1,{1,1})");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=MODE({5.6,4,4,3,2,4})"));
        let b = n(&eval("=MODE.SNGL({5.6,4,4,3,2,4})"));
        assert_eq!(a, b);
    }
}
