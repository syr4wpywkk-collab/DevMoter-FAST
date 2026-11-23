//! `T.INV(probability, deg_freedom)` — inverse of the left-tailed
//! t CDF: `x` with `P(T <= x) = p`. Spec: `docs/functions/T.INV.md`.
//!
//! [`numerics::t_inv`] enforces symmetry (`T.INV(0.5) = 0`,
//! `T.INV(1-p) = -T.INV(p)`) and solves on the shared t-CDF.
//! `deg_freedom` truncated; `p` outside `(0,1)` or `df < 1` -> `#NUM!`.
//! Legacy `TINV` was two-tailed — not aliased.

use crate::common::{numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let p = match statistics::scalar_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let df = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc(),
    };
    if p <= 0.0 || p >= 1.0 || df < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(numerics::t_inv(p, df)))
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
    fn upper_quantile() {
        // t_{0.05,10} one-sided = 1.812461
        let v = n(&eval("=T.INV(0.95,10)"));
        assert!((v - 1.812461123).abs() < 1e-7, "got {v}");
    }

    #[test]
    fn left_tail_quantile() {
        // T.DIST(-1.625537,60,TRUE) ~ 0.054645
        let v = n(&eval("=T.INV(0.054645,60)"));
        assert!((v - -1.6255367).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn half_gives_zero() {
        assert_eq!(n(&eval("=T.INV(0.5,5)")), 0.0);
    }

    #[test]
    fn symmetry() {
        let a = n(&eval("=T.INV(0.1,10)"));
        let b = n(&eval("=T.INV(0.9,10)"));
        assert!((a + b).abs() < 1e-12, "{a} + {b}");
    }

    #[test]
    fn inverts_cdf() {
        let x = n(&eval("=T.INV(0.8,7)"));
        let p = n(&eval(&format!("=T.DIST({x},7,TRUE)")));
        assert!((p - 0.8).abs() < 1e-9, "x={x} p={p}");
    }

    #[test]
    fn far_tail() {
        let x = n(&eval("=T.INV(0.9999,3)"));
        assert!(x > 10.0, "got {x}");
    }

    #[test]
    fn p_zero_num() {
        assert_eq!(e(&eval("=T.INV(0,10)")), CalcError::Num);
    }

    #[test]
    fn p_one_num() {
        assert_eq!(e(&eval("=T.INV(1,10)")), CalcError::Num);
    }

    #[test]
    fn p_negative_num() {
        assert_eq!(e(&eval("=T.INV(-0.5,10)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=T.INV(0.5,0.5)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=T.INV(0.9,10.9)"));
        let b = n(&eval("=T.INV(0.9,10)"));
        assert_eq!(a, b);
    }

    #[test]
    fn non_numeric_p_value() {
        assert_eq!(e(&eval(r#"=T.INV("x",10)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T.INV(1/0,10)")), CalcError::DivZero);
    }
}
