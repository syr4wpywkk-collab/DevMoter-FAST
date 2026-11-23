//! `NORM.INV(probability, mean, standard_dev)` — inverse normal CDF.
//! Spec: `docs/functions/NORM.INV.md`.

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
    let [p, mean, sd] = nums;
    if p <= 0.0 || p >= 1.0 || sd <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(mean + sd * numerics::normal_inv(p)))
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
        // Excel doc: NORM.INV(0.908789, 40, 1.5) ~= 42.
        assert!((n(&eval("=NORM.INV(0.908789,40,1.5)")) - 42.0).abs() < 1e-4);
    }

    #[test]
    fn median_is_mean() {
        assert_eq!(n(&eval("=NORM.INV(0.5,40,1.5)")), 40.0);
    }

    #[test]
    fn standard_matches_s_inv() {
        assert_eq!(
            n(&eval("=NORM.INV(0.975,0,1)")),
            n(&eval("=NORM.S.INV(0.975)"))
        );
    }

    #[test]
    fn round_trip() {
        let v = eval("=NORM.DIST(NORM.INV(0.908789,40,1.5),40,1.5,TRUE)");
        assert!((n(&v) - 0.908789).abs() < 1e-12);
    }

    #[test]
    fn affine_relation() {
        // NORM.INV(p,mu,sigma) = mu + sigma*z.
        assert!((n(&eval("=NORM.INV(0.9,10,2)")) - (10.0 + 2.0 * 1.2815515655446004)).abs() < 1e-9);
    }

    #[test]
    fn p_endpoints_num() {
        assert_eq!(e(&eval("=NORM.INV(0,0,1)")), CalcError::Num);
        assert_eq!(e(&eval("=NORM.INV(1,0,1)")), CalcError::Num);
    }

    #[test]
    fn sd_nonpositive_num() {
        assert_eq!(e(&eval("=NORM.INV(0.5,0,0)")), CalcError::Num);
        assert_eq!(e(&eval("=NORM.INV(0.5,0,-1)")), CalcError::Num);
    }

    #[test]
    fn text_value() {
        assert_eq!(e(&eval("=NORM.INV(\"x\",0,1)")), CalcError::Value);
        assert_eq!(e(&eval("=NORM.INV(0.5,\"x\",1)")), CalcError::Value);
        assert_eq!(e(&eval("=NORM.INV(0.5,0,\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=NORM.INV(0.5,0,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[
                ("A1", 0.975.into()),
                ("B1", 40.0.into()),
                ("C1", 1.5.into()),
            ],
            "=NORM.INV(A1,B1,C1)",
        );
        assert!((n(&v) - 42.93994597).abs() < 1e-6);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=NORM.INV(0.5,0)")), CalcError::Value);
    }
}
