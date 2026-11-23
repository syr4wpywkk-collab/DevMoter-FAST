//! `LOGNORM.INV(probability, mean, standard_dev)` — inverse lognormal
//! CDF: `exp(mean + sd * NORM.S.INV(p))`.
//! Spec: `docs/functions/LOGNORM.INV.md`.

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
    Ok(Value::Number((mean + sd * numerics::normal_inv(p)).exp()))
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
    fn inverts_doc_example() {
        assert!((n(&eval("=LOGNORM.INV(0.0390836,3.5,1.2)")) - 4.0).abs() < 1e-4);
    }

    #[test]
    fn median_is_exp_mean() {
        assert!((n(&eval("=LOGNORM.INV(0.5,3.5,1.2)")) - 3.5f64.exp()).abs() < 1e-9);
    }

    #[test]
    fn standard_median_is_one() {
        assert_eq!(n(&eval("=LOGNORM.INV(0.5,0,1)")), 1.0);
    }

    #[test]
    fn round_trip() {
        let v = eval("=LOGNORM.INV(LOGNORM.DIST(4,3.5,1.2,TRUE),3.5,1.2)");
        assert!((n(&v) - 4.0).abs() < 1e-9);
    }

    #[test]
    fn p_endpoints_num() {
        assert_eq!(e(&eval("=LOGNORM.INV(0,0,1)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGNORM.INV(1,0,1)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=LOGNORM.INV(-0.1,0,1)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGNORM.INV(1.1,0,1)")), CalcError::Num);
    }

    #[test]
    fn sd_nonpositive_num() {
        assert_eq!(e(&eval("=LOGNORM.INV(0.5,0,0)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGNORM.INV(0.5,0,-1)")), CalcError::Num);
    }

    #[test]
    fn text_value() {
        assert_eq!(e(&eval("=LOGNORM.INV(\"x\",0,1)")), CalcError::Value);
        assert_eq!(e(&eval("=LOGNORM.INV(0.5,0,\"x\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(n(&eval("=LOGNORM.INV(\"0.5\",0,1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LOGNORM.INV(1/0,0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=LOGNORM.INV(0.5,0)")), CalcError::Value);
    }
}
