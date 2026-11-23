//! `TRIMMEAN(array, percent)` — mean of the interior after excluding
//! `percent` of the data points, split evenly between the tails.
//! Spec: `docs/functions/TRIMMEAN.md`.
//!
//! The excluded count is `n * percent` rounded down to an even number
//! (Excel doc wording), i.e. `floor(n * p / 2)` points per tail.
//! `percent` outside `[0, 1)` -> `#NUM!`; no numeric values ->
//! `#DIV/0!` (SPEC-OPEN vs `#NUM!`, noted in the spec doc).

use crate::common::{coercion, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, &args[0..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let percent = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    if !(0.0..1.0).contains(&percent) {
        return Ok(Value::Error(CalcError::Num));
    }
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let mut sorted = nums.clone();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    let k = ((n as f64 * percent) / 2.0).floor() as usize;
    let kept = &sorted[k..n - k];
    Ok(Value::Number(kept.iter().sum::<f64>() / kept.len() as f64))
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
    fn excel_doc_example() {
        // Excel doc: TRIMMEAN({4;5;6;7;2;3;4;5;1;2;3}, 0.2) = 3.777778
        let v = n(&eval("=TRIMMEAN({4;5;6;7;2;3;4;5;1;2;3},0.2)"));
        assert!((v - 3.7777778).abs() < 1e-7, "got {v}");
    }

    #[test]
    fn zero_percent_is_mean() {
        assert_eq!(n(&eval("=TRIMMEAN({1;2;3;4;100},0)")), 22.0);
    }

    #[test]
    fn drops_one_per_tail() {
        // n=5, p=0.4 -> floor(5*0.4/2)=1 per tail -> mean{2,3,4}=3
        assert_eq!(n(&eval("=TRIMMEAN({1;2;3;4;5},0.4)")), 3.0);
    }

    #[test]
    fn even_rounding_rule() {
        // n=10, p=0.25 -> total 2.5 -> floor to even 2 -> 1 per tail
        let v = n(&eval("=TRIMMEAN({1;2;3;4;5;6;7;8;9;10},0.25)"));
        assert_eq!(v, 5.5);
    }

    #[test]
    fn percent_one_num() {
        assert_eq!(e(&eval("=TRIMMEAN({1;2;3},1)")), CalcError::Num);
    }

    #[test]
    fn negative_percent_num() {
        assert_eq!(e(&eval("=TRIMMEAN({1;2;3},-0.1)")), CalcError::Num);
    }

    #[test]
    fn empty_range_div_zero() {
        let v = eval_with(&[("A1", "x".into())], "=TRIMMEAN(A1:A3,0.2)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("A2", "x".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 20.0.into()),
            ],
            "=TRIMMEAN(A1:A5,0)",
        );
        assert_eq!(n(&v), 15.0);
    }

    #[test]
    fn non_numeric_percent_value() {
        assert_eq!(e(&eval(r#"=TRIMMEAN({1;2;3},"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=TRIMMEAN(A1:A2,0)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn direct_scalar_array() {
        assert_eq!(n(&eval("=TRIMMEAN({5;1;9},0)")), 5.0);
    }

    #[test]
    fn sorted_invariant() {
        // Order of the input does not matter.
        assert_eq!(
            n(&eval("=TRIMMEAN({9;1;5;3;7},0.4)")),
            n(&eval("=TRIMMEAN({1;3;5;7;9},0.4)"))
        );
    }
}
