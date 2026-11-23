//! `CHISQ.INV.RT(probability, deg_freedom)` — inverse of the
//! right-tailed chi-squared probability: `x` with `P(X >= x) = p`
//! (legacy `CHIINV`). Spec: `docs/functions/CHISQ.INV.RT.md`.
//!
//! Equivalent to `CHISQ.INV(1 - p, df)`; delegated to
//! [`chisq_inv::chisq_inv_cdf`] for a single solver path.
//! Boundary policy mirrors `CHISQ.INV` (SPEC-OPEN): `p = 1` -> `0`,
//! `p = 0` -> `#NUM!`.

use super::chisq_dist::valid_df;
use super::chisq_inv::chisq_inv_cdf;
use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let p = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let df = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if !(0.0..=1.0).contains(&p) || !valid_df(df) {
        return Ok(Value::Error(CalcError::Num));
    }
    if p == 1.0 {
        return Ok(Value::Number(0.0));
    }
    if p == 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = chisq_inv_cdf(1.0 - p, df);
    if v.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
    fn spec_example_upper_5pct() {
        let v = n(&eval("=CHISQ.INV.RT(0.05,10)"));
        assert!((v - 18.307038053275146).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_95pct() {
        let v = n(&eval("=CHISQ.INV.RT(0.95,10)"));
        assert!((v - 3.9402991365242097).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn round_trip_spec_example() {
        let v = n(&eval("=CHISQ.INV.RT(0.4795001221869535,1)"));
        assert!((v - 0.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn p_above_one_is_num() {
        assert_eq!(e(&eval("=CHISQ.INV.RT(1.5,10)")), CalcError::Num);
    }

    #[test]
    fn negative_p_is_num() {
        assert_eq!(e(&eval("=CHISQ.INV.RT(-0.1,10)")), CalcError::Num);
    }

    #[test]
    fn df_out_of_range_is_num() {
        assert_eq!(e(&eval("=CHISQ.INV.RT(0.5,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CHISQ.INV.RT(0.5,1E11)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=CHISQ.INV.RT("x",10)"#)), CalcError::Value);
    }

    #[test]
    fn p_one_is_zero() {
        assert_eq!(n(&eval("=CHISQ.INV.RT(1,10)")), 0.0);
    }

    #[test]
    fn round_trip_dist_rt() {
        let x = n(&eval("=CHISQ.INV.RT(0.3,7)"));
        let p = n(&eval(&format!("=CHISQ.DIST.RT({x},7)")));
        assert!((p - 0.3).abs() < 1e-9, "x={x} p={p}");
    }

    #[test]
    fn truncates_df() {
        let a = n(&eval("=CHISQ.INV.RT(0.5,9.9)"));
        let b = n(&eval("=CHISQ.INV.RT(0.5,9)"));
        assert_eq!(a, b);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CHISQ.INV.RT(1/0,10)")), CalcError::DivZero);
    }
}
