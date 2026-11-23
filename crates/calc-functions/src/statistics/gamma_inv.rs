//! `GAMMA.INV(probability, alpha, beta)` — inverse of the gamma CDF:
//! `x` with `P(alpha, x/beta) = probability`.
//! Spec: `docs/functions/GAMMA.INV.md`.
//!
//! `p` outside `[0,1]`, `alpha <= 0` or `beta <= 0` -> `#NUM!`; `p = 0`
//! -> `0`, `p = 1` -> `#NUM!` (unbounded — see the spec's boundary
//! open question). The inversion is [`numerics::regularized_gamma_inv`]
//! scaled by `beta`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, slot) in nums.iter_mut().enumerate() {
        *slot = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [p, alpha, beta] = nums;
    if !(0.0..=1.0).contains(&p) || alpha <= 0.0 || beta <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    if p == 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let x = numerics::regularized_gamma_inv(alpha, p) * beta;
    if x.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x))
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
    fn spec_roundtrip() {
        // Round-trip of GAMMA.DIST(10.00001131,9,2,TRUE) ≈ 0.068094.
        let v = n(&eval("=GAMMA.INV(0.068094,9,2)"));
        assert!((v - 10.0000113).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn closed_form() {
        // P(2, 2) = 1 - 3e^-2 -> inverse at 4.
        let v = n(&eval("=GAMMA.INV(0.5939941502901619,2,2)"));
        assert!((v - 4.0).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn exponential_median() {
        // alpha=beta=1: median = ln 2.
        let v = n(&eval("=GAMMA.INV(0.5,1,1)"));
        assert!((v - std::f64::consts::LN_2).abs() < 1e-10);
    }

    #[test]
    fn p_zero() {
        assert_eq!(n(&eval("=GAMMA.INV(0,1,1)")), 0.0);
    }

    #[test]
    fn p_one_num() {
        assert_eq!(e(&eval("=GAMMA.INV(1,1,1)")), CalcError::Num);
    }

    #[test]
    fn negative_p_num() {
        assert_eq!(e(&eval("=GAMMA.INV(-0.1,1,1)")), CalcError::Num);
    }

    #[test]
    fn p_above_one_num() {
        assert_eq!(e(&eval("=GAMMA.INV(1.1,1,1)")), CalcError::Num);
    }

    #[test]
    fn zero_alpha_num() {
        assert_eq!(e(&eval("=GAMMA.INV(0.5,0,1)")), CalcError::Num);
    }

    #[test]
    fn zero_beta_num() {
        assert_eq!(e(&eval("=GAMMA.INV(0.5,1,0)")), CalcError::Num);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=GAMMA.INV("a",1,1)"#)), CalcError::Value);
    }

    #[test]
    fn scale_by_beta() {
        // beta scales the result: GAMMA.INV(p,1,2) = 2*GAMMA.INV(p,1,1).
        let v = n(&eval("=GAMMA.INV(0.5,1,2)"));
        assert!((v - 2.0 * std::f64::consts::LN_2).abs() < 1e-9);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=GAMMA.INV(A1,1,1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=GAMMA.INV(0.5,1)")), CalcError::Value);
        assert_eq!(e(&eval("=GAMMA.INV(0.5,1,1,1)")), CalcError::Value);
    }
}
