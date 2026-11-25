//! `GAMMAINV(probability, alpha, beta)` — legacy inverse of the gamma
//! CDF: `x` with `P(alpha, x/beta) = probability`; equivalent to
//! `GAMMA.INV`. Spec: `docs/functions/GAMMAINV.md`.
//!
//! `p` outside `[0,1]`, `alpha <= 0` or `beta <= 0` -> `#NUM!`; `p = 1`
//! -> `#NUM!` (unbounded). The inversion is
//! [`numerics::regularized_gamma_inv`] scaled by `beta`;
//! non-convergence reports `#N/A` per the legacy spec.

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
        return Ok(Value::Error(CalcError::NA));
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
    fn spec_example() {
        let v = n(&eval("=GAMMAINV(0.068094,9,2)"));
        assert!((v - 10.0000112).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn spec_example_exponential() {
        // P(1, x) = 1 - e^-x; inverse of 0.632120559 is 1.
        let v = n(&eval("=GAMMAINV(0.632120559,1,1)"));
        assert!((v - 1.0).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn p_zero_gives_zero() {
        assert_eq!(n(&eval("=GAMMAINV(0,9,2)")), 0.0);
    }

    #[test]
    fn p_one_num() {
        assert_eq!(e(&eval("=GAMMAINV(1,9,2)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=GAMMAINV(1.5,9,2)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMAINV(-0.1,9,2)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_alpha_num() {
        assert_eq!(e(&eval("=GAMMAINV(0.5,0,2)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_beta_num() {
        assert_eq!(e(&eval("=GAMMAINV(0.5,9,0)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMAINV(0.5,9,-2)")), CalcError::Num);
    }

    #[test]
    fn round_trip() {
        let v = n(&eval("=GAMMAINV(GAMMADIST(4,3,1.5,TRUE),3,1.5)"));
        assert!((v - 4.0).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=GAMMAINV("x",9,2)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        let v = n(&eval(r#"=GAMMAINV("0.5",1,1)"#));
        assert!((v - std::f64::consts::LN_2).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=GAMMAINV(0.4,3,1.5)"));
        let b = n(&eval("=GAMMA.INV(0.4,3,1.5)"));
        assert!((a - b).abs() < 1e-9, "{a} vs {b}");
    }
}
