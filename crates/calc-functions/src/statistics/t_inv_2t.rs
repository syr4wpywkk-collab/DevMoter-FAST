//! `T.INV.2T(probability, deg_freedom)` — inverse of the two-tailed
//! t distribution: positive `x` with `P(|T| >= x) = p`. Spec:
//! `docs/functions/T.INV.2T.md`.
//!
//! `T.INV.2T(p, df) = T.INV(1 - p/2, df)`. `p <= 0` or `p > 1` ->
//! `#NUM!`; `p = 1` -> `0` (Excel's documented boundary). Modern
//! equivalent of legacy `TINV` — that name is not registered.

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
        // t_{0.025,10} = 2.228139
        let v = n(&eval("=T.INV.2T(0.05,10)"));
        assert!((v - 2.2281389).abs() < 1e-7, "got {v}");
    }

    #[test]
    fn excel_doc_example() {
        // Excel doc: T.INV.2T(0.546449,60) = 0.606533
        let v = n(&eval("=T.INV.2T(0.546449,60)"));
        assert!((v - 0.6065331).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn p_one_gives_zero() {
        assert_eq!(n(&eval("=T.INV.2T(1,10)")), 0.0);
    }

    #[test]
    fn always_positive() {
        let v = n(&eval("=T.INV.2T(0.9,5)"));
        assert!(v > 0.0, "got {v}");
    }

    #[test]
    fn inverts_2t() {
        let x = n(&eval("=T.INV.2T(0.2,7)"));
        let p = n(&eval(&format!("=T.DIST.2T({x},7)")));
        assert!((p - 0.2).abs() < 1e-9, "x={x} p={p}");
    }

    #[test]
    fn p_zero_num() {
        assert_eq!(e(&eval("=T.INV.2T(0,10)")), CalcError::Num);
    }

    #[test]
    fn p_above_one_num() {
        assert_eq!(e(&eval("=T.INV.2T(1.5,10)")), CalcError::Num);
    }

    #[test]
    fn p_negative_num() {
        assert_eq!(e(&eval("=T.INV.2T(-0.5,10)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=T.INV.2T(0.5,0.5)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=T.INV.2T(0.05,10.9)"));
        let b = n(&eval("=T.INV.2T(0.05,10)"));
        assert_eq!(a, b);
    }

    #[test]
    fn non_numeric_p_value() {
        assert_eq!(e(&eval(r#"=T.INV.2T("x",10)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T.INV.2T(1/0,10)")), CalcError::DivZero);
    }
}
