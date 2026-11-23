//! `CHIINV(probability, deg_freedom)` — legacy inverse of the
//! right-tailed chi-squared distribution: `x` with
//! `CHIDIST(x, df) = probability`; equivalent to `CHISQ.INV.RT`.
//! Spec: `docs/functions/CHIINV.md`.
//!
//! Computed as `2 * regularized_gamma_inv(df/2, 1 - p)`. Boundary
//! policy mirrors `CHISQ.INV.RT`: `p = 1` -> `0`, `p = 0` -> `#NUM!`
//! (the quantile is unbounded). Non-convergence reports `#N/A` per
//! the legacy spec.

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
    let v = 2.0 * numerics::regularized_gamma_inv(df / 2.0, 1.0 - p);
    if v.is_nan() {
        return Ok(Value::Error(CalcError::NA));
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
    fn spec_example_df2() {
        let v = n(&eval("=CHIINV(0.05,2)"));
        assert!((v - 5.991464547107979).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_df10() {
        let v = n(&eval("=CHIINV(0.05,10)"));
        assert!((v - 18.307).abs() < 1e-3, "got {v}");
    }

    #[test]
    fn round_trip() {
        let v = n(&eval("=CHIINV(CHIDIST(7.5,6),6)"));
        assert!((v - 7.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn p_one_gives_zero() {
        assert_eq!(n(&eval("=CHIINV(1,5)")), 0.0);
    }

    #[test]
    fn p_zero_num() {
        // Unbounded quantile (SPEC-OPEN resolution mirrors CHISQ.INV.RT).
        assert_eq!(e(&eval("=CHIINV(0,5)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=CHIINV(1.5,2)")), CalcError::Num);
        assert_eq!(e(&eval("=CHIINV(-0.1,2)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=CHIINV(0.5,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CHIINV(0.5,0.9)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=CHIINV(0.3,4.9)"));
        let b = n(&eval("=CHIINV(0.3,4)"));
        assert_eq!(a, b);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=CHIINV("x",5)"#)), CalcError::Value);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=CHIINV(0.3,7)"));
        let b = n(&eval("=CHISQ.INV.RT(0.3,7)"));
        assert!((a - b).abs() < 1e-9, "{a} vs {b}");
    }
}
