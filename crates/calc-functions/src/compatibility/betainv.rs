//! `BETAINV(probability, alpha, beta, [A], [B])` — legacy inverse of
//! the cumulative beta distribution on `[A,B]` (default `[0,1]`);
//! equivalent to `BETA.INV`. Spec: `docs/functions/BETAINV.md`.
//!
//! Solves `I_z(alpha, beta) = p` for `z ∈ [0,1]` with
//! [`numerics::regularized_beta_inv`], then scales to
//! `A + z(B - A)`. Non-convergence reports `#N/A` (documented for the
//! legacy inverse functions).

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
    let z = numerics::regularized_beta_inv(p, alpha, beta);
    if z.is_nan() {
        return Ok(Value::Error(CalcError::NA));
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
    fn spec_example_median() {
        let v = n(&eval("=BETAINV(0.5,2,2)"));
        assert!((v - 0.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_three_quarter() {
        let v = n(&eval("=BETAINV(0.84375,2,2)"));
        assert!((v - 0.75).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_with_bounds() {
        // Inverts BETADIST(8,2,3,5,10) = 0.8208 (see betadist tests).
        let v = n(&eval("=BETAINV(0.8208,2,3,5,10)"));
        assert!((v - 8.0).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn round_trip() {
        let v = n(&eval("=BETAINV(BETADIST(0.3,4,6),4,6)"));
        assert!((v - 0.3).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn endpoints() {
        assert_eq!(n(&eval("=BETAINV(0,2,2)")), 0.0);
        assert_eq!(n(&eval("=BETAINV(1,2,2)")), 1.0);
        assert_eq!(n(&eval("=BETAINV(1,2,2,5,10)")), 10.0);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=BETAINV(1.5,2,2)")), CalcError::Num);
        assert_eq!(e(&eval("=BETAINV(-0.1,2,2)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_shape_num() {
        assert_eq!(e(&eval("=BETAINV(0.5,0,2)")), CalcError::Num);
        assert_eq!(e(&eval("=BETAINV(0.5,2,0)")), CalcError::Num);
    }

    #[test]
    fn a_equals_b_num() {
        assert_eq!(e(&eval("=BETAINV(0.5,2,2,1,1)")), CalcError::Num);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=BETAINV("x",2,2)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        let v = n(&eval(r#"=BETAINV("0.5",2,2)"#));
        assert!((v - 0.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=BETAINV(0.4,3,5)"));
        let b = n(&eval("=BETA.INV(0.4,3,5)"));
        assert!((a - b).abs() < 1e-9, "{a} vs {b}");
    }
}
