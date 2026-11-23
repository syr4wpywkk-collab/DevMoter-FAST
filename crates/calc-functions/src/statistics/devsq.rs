//! `DEVSQ(number1, [number2], ...)` — sum of squared deviations from
//! the mean `Σ(x - x̄)²` (= `n·VAR.P` = `(n-1)·VAR.S`). Spec:
//! `docs/functions/DEVSQ.md`.
//!
//! Same coercion contract as `AVERAGE`/`AVEDEV`. Two-pass deviation
//! accumulation (the `sample_variance` rationale in
//! `common::statistics`) — the naive `Σx² - (Σx)²/n` form cancels
//! catastrophically when `|x̄|` is large.

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
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let mean = nums.iter().sum::<f64>() / nums.len() as f64;
    let devsq = nums
        .iter()
        .map(|x| {
            let d = x - mean;
            d * d
        })
        .sum::<f64>();
    Ok(Value::Number(devsq))
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
        // mean 6; Σ(x-6)² = 48
        assert_eq!(n(&eval("=DEVSQ(4,5,8,7,11,4,3)")), 48.0);
    }

    #[test]
    fn array_constant() {
        assert_eq!(n(&eval("=DEVSQ({1,2,3})")), 2.0);
    }

    #[test]
    fn single_value_is_zero() {
        assert_eq!(n(&eval("=DEVSQ(5)")), 0.0);
    }

    #[test]
    fn empty_range_is_divzero() {
        assert_eq!(e(&eval("=DEVSQ(Z1:Z3)")), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 3.0.into())],
            "=DEVSQ(A1:A3)",
        );
        // {1,3}: mean 2, devsq = 2
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn direct_scalar_coerces() {
        // TRUE -> 1, "3" -> 3: mean 2, devsq = 2
        assert_eq!(n(&eval(r#"=DEVSQ(TRUE,"3")"#)), 2.0);
    }

    #[test]
    fn bad_text_scalar_is_value() {
        assert_eq!(e(&eval(r#"=DEVSQ("abc")"#)), CalcError::Value);
    }

    #[test]
    fn equals_n_minus_1_times_var_s() {
        let d = n(&eval("=DEVSQ(2,4,6,8,10)"));
        let v = n(&eval("=VAR.S(2,4,6,8,10)"));
        assert!((d - 4.0 * v).abs() < 1e-12, "d={d} v={v}");
    }

    #[test]
    fn large_offset_no_cancellation() {
        // 1e9,1e9+1,1e9+2 -> devsq 2; naive Σx²-(Σx)²/n loses this.
        let v = n(&eval("=DEVSQ(1000000000,1000000001,1000000002)"));
        assert!((v - 2.0).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn mixed_args() {
        // scalar + range + array
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 5.0.into())],
            "=DEVSQ(8,A1:A2,{7,11,4,3})",
        );
        // {8,4,5,7,11,4,3}: mean 6, devsq = 4+4+1+1+25+4+9 = 48
        assert_eq!(n(&v), 48.0);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=DEVSQ(1,1/0)")), CalcError::DivZero);
    }
}
