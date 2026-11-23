//! `NORMINV(probability, mean, standard_dev)` — legacy inverse normal
//! CDF. Spec: `docs/functions/NORMINV.md`.
//!
//! `NORMINV(p, m, s) = m + s * NORMSINV(p)` via
//! [`numerics::normal_inv`] (Acklam + Halley refinement — more accurate
//! than Excel's documented ~3e-7 iteration; difference from Excel is
//! a recorded spec open question).

use crate::common::{numerics, statistics};
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
        match statistics::scalar_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => *slot = v,
        }
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
        // Excel doc: NORMINV(0.908789,40,1.5) ~= 42.
        let v = n(&eval("=NORMINV(0.908789,40,1.5)"));
        assert!((v - 42.0).abs() < 5e-4, "got {v}");
    }

    #[test]
    fn median_is_mean() {
        assert_eq!(n(&eval("=NORMINV(0.5,40,1.5)")), 40.0);
    }

    #[test]
    fn quantile_975() {
        let v = n(&eval("=NORMINV(0.975,0,1)"));
        assert!((v - 1.9599640).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn rounds_trip_normdist() {
        let x = n(&eval("=NORMINV(0.9,10,2)"));
        let back = n(&eval(&format!("=NORMDIST({x},10,2,TRUE)")));
        assert!((back - 0.9).abs() < 1e-12);
    }

    #[test]
    fn matches_norm_inv() {
        assert_eq!(
            n(&eval("=NORMINV(0.9,10,2)")),
            n(&eval("=NORM.INV(0.9,10,2)"))
        );
    }

    #[test]
    fn boundary_p_num() {
        assert_eq!(e(&eval("=NORMINV(0,40,1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMINV(1,40,1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMINV(-0.1,0,1)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMINV(1.1,0,1)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_sd_num() {
        assert_eq!(e(&eval("=NORMINV(0.5,0,0)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMINV(0.5,0,-1)")), CalcError::Num);
    }

    #[test]
    fn negative_sd_even_with_valid_p() {
        assert_eq!(e(&eval("=NORMINV(0.9,10,-2)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=NORMINV(\"x\",0,1)")), CalcError::Value);
        assert_eq!(e(&eval("=NORMINV(0.5,\"x\",1)")), CalcError::Value);
        assert_eq!(e(&eval("=NORMINV(0.5,0,\"x\")")), CalcError::Value);
    }

    #[test]
    fn text_coercion() {
        let v = n(&eval("=NORMINV(\"0.975\",0,1)"));
        assert!((v - 1.9599640).abs() < 1e-6);
    }

    #[test]
    fn scales_with_sd() {
        // NORMINV(p, m, s) = m + s * NORMSINV(p)
        let v = n(&eval("=NORMINV(0.9,100,5)"));
        let z = n(&eval("=NORMSINV(0.9)"));
        assert!((v - (100.0 + 5.0 * z)).abs() < 1e-12);
    }
}
