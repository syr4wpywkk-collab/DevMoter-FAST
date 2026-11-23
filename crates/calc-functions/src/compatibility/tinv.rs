//! `TINV(probability, deg_freedom)` — legacy inverse of the
//! **two-tailed** t distribution. Spec: `docs/functions/TINV.md`.
//!
//! Identical to `T.INV.2T`: `TINV(p, v) = t^{-1}(1 - p/2, v)` via
//! [`numerics::t_inv`]. `p = 1` -> `0` (Excel's documented
//! boundary); `p <= 0` or `p > 1` -> `#NUM!`.

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
    if p <= 0.0 || p > 1.0 || df < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(numerics::t_inv(1.0 - p / 2.0, df)))
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
    fn alpha_05_df10() {
        // t_{0.025,10} = 2.228139 (standard t-table value).
        let v = n(&eval("=TINV(0.05,10)"));
        assert!((v - 2.2281389).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn doc_paired_value() {
        // Pairs with the TDIST docs example.
        let v = n(&eval("=TINV(0.054645,60)"));
        assert!((v - 1.959999998).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn p_one_is_zero() {
        assert_eq!(n(&eval("=TINV(1,10)")), 0.0);
    }

    #[test]
    fn p_zero_num() {
        assert_eq!(e(&eval("=TINV(0,10)")), CalcError::Num);
        assert_eq!(e(&eval("=TINV(-0.1,10)")), CalcError::Num);
    }

    #[test]
    fn p_above_one_num() {
        assert_eq!(e(&eval("=TINV(1.5,10)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=TINV(0.05,0.9)")), CalcError::Num);
    }

    #[test]
    fn df_truncates() {
        assert_eq!(n(&eval("=TINV(0.05,10.9)")), n(&eval("=TINV(0.05,10)")));
    }

    #[test]
    fn matches_t_inv_2t() {
        assert_eq!(n(&eval("=TINV(0.1,25)")), n(&eval("=T.INV.2T(0.1,25)")));
    }

    #[test]
    fn relation_to_t_inv() {
        // TINV(p,df) = T.INV(1 - p/2, df)
        assert_eq!(n(&eval("=TINV(0.2,15)")), n(&eval("=T.INV(0.9,15)")));
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=TINV(\"x\",10)")), CalcError::Value);
        assert_eq!(e(&eval("=TINV(0.05,\"x\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        let v = n(&eval("=TINV(\"0.05\",10)"));
        assert!((v - 2.2281389).abs() < 1e-6);
    }

    #[test]
    fn result_positive_for_small_p() {
        assert!(n(&eval("=TINV(0.5,10)")) > 0.0);
    }
}
