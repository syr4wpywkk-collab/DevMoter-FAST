//! `FREQUENCY(data_array, bins_array)` — vertical array of counts per
//! bin, `n_bins + 1` elements (bin upper bounds inclusive; the last
//! element counts values above the largest bin). Spec:
//! `docs/functions/FREQUENCY.md`.
//!
//! Non-numeric members of either array are ignored. Bins are used in
//! sorted order (ascending thresholds) — unsorted-bin handling is a
//! spec open question, sorted matches the documented result.
//! Zero bins yields a one-element array with the total data count.

use crate::common::statistics;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let data = match statistics::array_numbers(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d,
    };
    let mut bins = match statistics::array_numbers(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    bins.sort_by(f64::total_cmp);
    let mut counts = vec![0.0f64; bins.len() + 1];
    for x in &data {
        // First bin upper bound >= x; none -> overflow slot.
        let i = bins.partition_point(|b| x > b);
        counts[i] += 1.0;
    }
    match ArrayValue::from_column(counts.into_iter().map(Value::Number).collect()) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn a(v: &Value) -> Vec<f64> {
        match v {
            Value::Array(a) => a
                .cells()
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
    fn spec_example() {
        assert_eq!(
            a(&eval("=FREQUENCY({1,2,3,4,5},{2,4})")),
            vec![2.0, 2.0, 1.0]
        );
    }

    #[test]
    fn spec_example_grades() {
        assert_eq!(
            a(&eval("=FREQUENCY({79,85,90,97},{80,90,100})")),
            vec![1.0, 2.0, 1.0, 0.0]
        );
    }

    #[test]
    fn duplicate_data() {
        assert_eq!(a(&eval("=FREQUENCY({1,1,1},{1})")), vec![3.0, 0.0]);
    }

    #[test]
    fn bin_boundary_inclusive() {
        // Values equal to a bin bound count in that bin.
        assert_eq!(a(&eval("=FREQUENCY({2,4},{2,4})")), vec![1.0, 1.0, 0.0]);
    }

    #[test]
    fn all_above_largest_bin() {
        assert_eq!(a(&eval("=FREQUENCY({10,20},{5})")), vec![0.0, 2.0]);
    }

    #[test]
    fn empty_data_gives_zeros() {
        let v = eval_with(&[("A1", "x".into())], "=FREQUENCY(A1:A1,{1,2})");
        assert_eq!(a(&v), vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn empty_bins_gives_total() {
        let v = eval_with(&[("A1", "x".into())], "=FREQUENCY({1,2,3},A1:A1)");
        assert_eq!(a(&v), vec![3.0]);
    }

    #[test]
    fn ranges_form() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
            ],
            "=FREQUENCY(A1:A3,B1:B1)",
        );
        assert_eq!(a(&v), vec![2.0, 1.0]);
    }

    #[test]
    fn text_in_data_ignored() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 3.0.into())],
            "=FREQUENCY(A1:A3,{2})",
        );
        assert_eq!(a(&v), vec![1.0, 1.0]);
    }

    #[test]
    fn unsorted_bins_sorted() {
        // Sorted threshold semantics (spec open question).
        assert_eq!(
            a(&eval("=FREQUENCY({1,2,3,4,5},{4,2})")),
            vec![2.0, 2.0, 1.0]
        );
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=FREQUENCY(A1:A1,{1})",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=FREQUENCY({1})")), CalcError::Value);
    }
}
