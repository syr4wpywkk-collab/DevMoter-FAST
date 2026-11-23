//! `FINV(probability, deg_freedom1, deg_freedom2)` — legacy inverse of
//! the right-tailed F distribution: `x` with `FDIST(x, df1, df2) =
//! probability`; equivalent to `F.INV.RT`. Spec: `docs/functions/FINV.md`.
//!
//! Delegates to [`numerics::f_inv`] at `1 - p`. `p` outside `[0,1]` or
//! out-of-range df -> `#NUM!`; `p = 0` (unbounded quantile) -> `#NUM!`
//! mirroring `F.INV.RT`; non-convergence reports `#N/A` per the legacy
//! spec.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Legacy `deg_freedom` domain: `1 <= df < 10^10` after truncation.
fn valid_df(df: f64) -> bool {
    (1.0..1e10).contains(&df)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let p = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let df1 = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let df2 = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if !(0.0..=1.0).contains(&p) || !valid_df(df1) || !valid_df(df2) {
        return Ok(Value::Error(CalcError::Num));
    }
    let x = numerics::f_inv(1.0 - p, df1, df2);
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
    fn spec_example_1pct() {
        let v = n(&eval("=FINV(0.01,6,4)"));
        assert!((v - 15.20686486).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn spec_example_f25() {
        // Exact right tail of F(2,5) at 4 is 0.0917416... (see fdist).
        let v = n(&eval("=FINV(0.09174166759556843,2,5)"));
        assert!((v - 4.0).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn median_f11() {
        let v = n(&eval("=FINV(0.5,1,1)"));
        assert!((v - 1.0).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn p_one_gives_zero() {
        assert_eq!(n(&eval("=FINV(1,6,4)")), 0.0);
    }

    #[test]
    fn p_zero_num() {
        // Unbounded quantile (mirrors F.INV.RT).
        assert_eq!(e(&eval("=FINV(0,6,4)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=FINV(2,5,5)")), CalcError::Num);
        assert_eq!(e(&eval("=FINV(-0.1,5,5)")), CalcError::Num);
    }

    #[test]
    fn df_out_of_range_num() {
        assert_eq!(e(&eval("=FINV(0.5,0,4)")), CalcError::Num);
        assert_eq!(e(&eval("=FINV(0.5,6,0)")), CalcError::Num);
        assert_eq!(e(&eval("=FINV(0.5,1e10,4)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=FINV(0.3,4.9,5)"));
        let b = n(&eval("=FINV(0.3,4,5)"));
        assert_eq!(a, b);
    }

    #[test]
    fn round_trip() {
        let v = n(&eval("=FINV(FDIST(2.5,6,8),6,8)"));
        assert!((v - 2.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=FINV("x",5,5)"#)), CalcError::Value);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=FINV(0.3,6,8)"));
        let b = n(&eval("=F.INV.RT(0.3,6,8)"));
        assert!((a - b).abs() < 1e-9, "{a} vs {b}");
    }
}
