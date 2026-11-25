//! `LOGINV(probability, mean, standard_dev)` — legacy inverse of the
//! lognormal cumulative distribution:
//! `exp(mean + standard_dev * NORMSINV(p))`; equivalent to
//! `LOGNORM.INV`. Spec: `docs/functions/LOGINV.md`.

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
    fn spec_example_median() {
        // e^3.5
        let v = n(&eval("=LOGINV(0.5,3.5,1.2)"));
        assert!((v - 33.11545196).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn spec_example_inverts_doc() {
        let v = n(&eval("=LOGINV(0.039084,3.5,1.2)"));
        assert!((v - 4.0).abs() < 1e-3, "got {v}");
    }

    #[test]
    fn standard_median_is_one() {
        assert_eq!(n(&eval("=LOGINV(0.5,0,1)")), 1.0);
    }

    #[test]
    fn round_trip() {
        let v = n(&eval("=LOGINV(LOGNORMDIST(4,3.5,1.2),3.5,1.2)"));
        assert!((v - 4.0).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn p_zero_num() {
        assert_eq!(e(&eval("=LOGINV(0,3.5,1.2)")), CalcError::Num);
    }

    #[test]
    fn p_one_num() {
        assert_eq!(e(&eval("=LOGINV(1,3.5,1.2)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=LOGINV(-0.1,3.5,1.2)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGINV(1.1,3.5,1.2)")), CalcError::Num);
    }

    #[test]
    fn sd_nonpositive_num() {
        assert_eq!(e(&eval("=LOGINV(0.5,3.5,0)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGINV(0.5,3.5,-1)")), CalcError::Num);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=LOGINV("x",3.5,1.2)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        let v = n(&eval(r#"=LOGINV("0.5",0,1)"#));
        assert_eq!(v, 1.0);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=LOGINV(0.3,1,0.5)"));
        let b = n(&eval("=LOGNORM.INV(0.3,1,0.5)"));
        assert_eq!(a, b);
    }
}
