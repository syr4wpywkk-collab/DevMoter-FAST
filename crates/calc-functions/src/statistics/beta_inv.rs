//! `BETA.INV(probability, alpha, beta, [A], [B])` — inverse of the beta
//! CDF on `[A,B]` (default `[0,1]`). Spec: `docs/functions/BETA.INV.md`.
//!
//! Solves `I_z(alpha, beta) = p` for `z ∈ [0,1]` with
//! [`numerics::inverse_cdf`], then scales back to `A + z(B - A)`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [p, alpha, beta] = nums;
    let (mut lo, mut hi) = (0.0, 1.0);
    for (i, out) in [(3, &mut lo), (4, &mut hi)] {
        if args.len() > i {
            *out = match coercion::eval_number(ctx, &args[i])? {
                Err(e) => return Ok(Value::Error(e)),
                Ok(v) => v,
            };
        }
    }

    if alpha <= 0.0
        || beta <= 0.0
        || !(0.0..=1.0).contains(&p)
        || lo == hi
        || !(lo.is_finite() && hi.is_finite())
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let z = numerics::inverse_cdf(
        |z| numerics::regularized_beta(z, alpha, beta),
        p,
        0.0,
        1.0,
        1e-13,
        300,
    );
    if z.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(lo + z * (hi - lo)))
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
    fn round_trip_with_bounds() {
        let v = n(&eval("=BETA.INV(0.6854705810117458,8,10,1,3)"));
        assert!((v - 2.0).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn symmetric_median() {
        let v = n(&eval("=BETA.INV(0.5,2,2)"));
        assert!((v - 0.5).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn round_trip_standard() {
        let v = n(&eval("=BETA.INV(0.6875,2,3)"));
        assert!((v - 0.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn negative_probability_num() {
        assert_eq!(e(&eval("=BETA.INV(-0.1,2,3)")), CalcError::Num);
    }

    #[test]
    fn probability_above_one_num() {
        assert_eq!(e(&eval("=BETA.INV(1.1,2,3)")), CalcError::Num);
    }

    #[test]
    fn alpha_zero_num() {
        assert_eq!(e(&eval("=BETA.INV(0.5,0,1)")), CalcError::Num);
    }

    #[test]
    fn beta_negative_num() {
        assert_eq!(e(&eval("=BETA.INV(0.5,1,-2)")), CalcError::Num);
    }

    #[test]
    fn boundary_zero() {
        assert_eq!(n(&eval("=BETA.INV(0,2,3)")), 0.0);
    }

    #[test]
    fn boundary_one() {
        assert_eq!(n(&eval("=BETA.INV(1,2,3)")), 1.0);
    }

    #[test]
    fn boundary_with_bounds() {
        assert_eq!(n(&eval("=BETA.INV(0,2,3,5,9)")), 5.0);
        assert_eq!(n(&eval("=BETA.INV(1,2,3,5,9)")), 9.0);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=BETA.INV("x",2,3)"#)), CalcError::Value);
    }

    #[test]
    fn uniform_inv_identity() {
        // Beta(1,1) inverse is p itself, scaled to [A,B].
        let a = n(&eval("=BETA.INV(0.25,1,1)"));
        assert!((a - 0.25).abs() < 1e-12, "got {a}");
        let b = n(&eval("=BETA.INV(0.25,1,1,0,4)"));
        assert!((b - 1.0).abs() < 1e-12, "got {b}");
    }
}
