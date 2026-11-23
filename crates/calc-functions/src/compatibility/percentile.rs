//! `PERCENTILE(array, k)` — legacy inclusive percentile with linear
//! interpolation. Spec: `docs/functions/PERCENTILE.md`.
//!
//! Identical algorithm to `PERCENTILE.INC`: `k` is a fraction in
//! `[0,1]`; rank `r = k*(n-1)` interpolates between the sorted
//! elements. Same shared kernel `statistics::percentile_inc_sorted`.

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
    let k = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(k) => k,
    };
    if nums.is_empty() || !(0.0..=1.0).contains(&k) {
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    Ok(Value::Number(statistics::percentile_inc_sorted(&nums, k)))
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
    fn doc_example() {
        // Excel doc: PERCENTILE({1,3,2,4},0.3) = 1.9.
        assert_eq!(n(&eval("=PERCENTILE({1,3,2,4},0.3)")), 1.9);
    }

    #[test]
    fn median_at_half() {
        assert_eq!(n(&eval("=PERCENTILE({1,2,3,4,5},0.5)")), 3.0);
    }

    #[test]
    fn boundaries() {
        assert_eq!(n(&eval("=PERCENTILE({1,2,3,4,5},0)")), 1.0);
        assert_eq!(n(&eval("=PERCENTILE({1,2,3,4,5},1)")), 5.0);
    }

    #[test]
    fn matches_percentile_inc() {
        assert_eq!(
            n(&eval("=PERCENTILE({4,1,9,2},0.25)")),
            n(&eval("=PERCENTILE.INC({4,1,9,2},0.25)"))
        );
    }

    #[test]
    fn quartile_equivalence() {
        assert_eq!(
            n(&eval("=PERCENTILE({1,2,4,7,8,9,10,12},0.25)")),
            n(&eval("=QUARTILE({1,2,4,7,8,9,10,12},1)"))
        );
    }

    #[test]
    fn k_out_of_range_num() {
        assert_eq!(e(&eval("=PERCENTILE({1,2,3},1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=PERCENTILE({1,2,3},-0.1)")), CalcError::Num);
    }

    #[test]
    fn empty_range_num() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=PERCENTILE(A1:A3,0.5)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn range_ignores_text_and_blanks() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(3.0)),
            ],
            "=PERCENTILE(A1:A3,0.5)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn non_numeric_k_value() {
        assert_eq!(e(&eval("=PERCENTILE({1,2,3},\"x\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_k_coerces() {
        assert_eq!(n(&eval("=PERCENTILE({1,2,3,4,5},\"0.5\")")), 3.0);
    }

    #[test]
    fn single_element() {
        assert_eq!(n(&eval("=PERCENTILE({7},0.5)")), 7.0);
        assert_eq!(n(&eval("=PERCENTILE({7},0)")), 7.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=PERCENTILE(A1:A2,0.5)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }
}
