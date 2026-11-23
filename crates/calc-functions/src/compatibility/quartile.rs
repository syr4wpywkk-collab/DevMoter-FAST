//! `QUARTILE(array, quart)` — legacy quartile (inclusive method).
//! Spec: `docs/functions/QUARTILE.md`.
//!
//! Identical to `QUARTILE.INC`: `QUARTILE(a, q) = PERCENTILE(a, q/4)`
//! via `statistics::percentile_inc_sorted`. `quart` truncated to an
//! integer in `0..=4`.

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
    if nums.is_empty() || !(0.0..=4.0).contains(&quart) {
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    Ok(Value::Number(statistics::percentile_inc_sorted(
        &nums,
        quart / 4.0,
    )))
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

    const A: &str = "{1,2,4,7,8,9,10,12}";

    #[test]
    fn doc_example_q1() {
        // Excel doc: QUARTILE(A,1) = 3.5.
        assert_eq!(n(&eval(&format!("=QUARTILE({A},1)"))), 3.5);
    }

    #[test]
    fn doc_example_median() {
        assert_eq!(n(&eval(&format!("=QUARTILE({A},2)"))), 7.5);
    }

    #[test]
    fn min_and_max() {
        assert_eq!(n(&eval(&format!("=QUARTILE({A},0)"))), 1.0);
        assert_eq!(n(&eval(&format!("=QUARTILE({A},4)"))), 12.0);
    }

    #[test]
    fn q3() {
        // r = 0.75*7 = 5.25 -> 9 + 0.25*(10-9) = 9.25
        assert_eq!(n(&eval(&format!("=QUARTILE({A},3)"))), 9.25);
    }

    #[test]
    fn matches_quartile_inc() {
        assert_eq!(
            n(&eval(&format!("=QUARTILE({A},3)"))),
            n(&eval(&format!("=QUARTILE.INC({A},3)")))
        );
    }

    #[test]
    fn percentile_equivalence() {
        assert_eq!(
            n(&eval(&format!("=QUARTILE({A},1)"))),
            n(&eval(&format!("=PERCENTILE({A},0.25)")))
        );
    }

    #[test]
    fn quart_out_of_range_num() {
        assert_eq!(e(&eval("=QUARTILE({1,2,3},5)")), CalcError::Num);
        assert_eq!(e(&eval("=QUARTILE({1,2,3},-1)")), CalcError::Num);
    }

    #[test]
    fn quart_truncates() {
        assert_eq!(
            n(&eval("=QUARTILE({1,2,3,4},1.9)")),
            n(&eval("=QUARTILE({1,2,3,4},1)"))
        );
    }

    #[test]
    fn empty_range_num() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=QUARTILE(A1:A3,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn non_numeric_quart_value() {
        assert_eq!(e(&eval("=QUARTILE({1,2,3},\"x\")")), CalcError::Value);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(3.0)),
            ],
            "=QUARTILE(A1:A3,2)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=QUARTILE(A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }
}
