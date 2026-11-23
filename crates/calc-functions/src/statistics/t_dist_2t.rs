//! `T.DIST.2T(x, deg_freedom)` — two-tailed t probability
//! `P(|T| >= x)`. Spec: `docs/functions/T.DIST.2T.md`.
//!
//! `= 2 * T.DIST.RT(x, df)`; `x = 0` -> `1`. Negative `x` is `#NUM!`
//! (Excel's documented behavior — no implicit `abs`). `deg_freedom`
//! truncated; `df < 1` -> `#NUM!`.

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
    let x = match statistics::scalar_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    if x < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let df = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc(),
    };
    if df < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((2.0 * numerics::t_sf(x, df)).min(1.0)))
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
    fn excel_doc_example() {
        // Excel doc: T.DIST.2T(1.959999998,60) = 0.054645
        let v = n(&eval("=T.DIST.2T(1.959999998,60)"));
        assert!((v - 0.0546449297).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn zero_gives_one() {
        assert_eq!(n(&eval("=T.DIST.2T(0,10)")), 1.0);
    }

    #[test]
    fn critical_value_gives_alpha() {
        // t_{0.025,10} = 2.228139 -> two-tailed p = 0.05
        let v = n(&eval("=T.DIST.2T(2.228139,10)"));
        assert!((v - 0.05).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=T.DIST.2T(-1,10)")), CalcError::Num);
    }

    #[test]
    fn twice_right_tail() {
        let a = n(&eval("=T.DIST.2T(1.5,10)"));
        let b = n(&eval("=T.DIST.RT(1.5,10)"));
        assert!((a - 2.0 * b).abs() < 1e-12, "{a} vs {b}");
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=T.DIST.2T(1,10.9)"));
        let b = n(&eval("=T.DIST.2T(1,10)"));
        assert_eq!(a, b);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=T.DIST.2T(1,0.5)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(e(&eval(r#"=T.DIST.2T("x",10)"#)), CalcError::Value);
    }

    #[test]
    fn non_numeric_df_value() {
        assert_eq!(e(&eval(r#"=T.DIST.2T(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn result_bounded() {
        let v = n(&eval("=T.DIST.2T(0.001,1)"));
        assert!(v <= 1.0 && v > 0.99, "got {v}");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T.DIST.2T(1/0,10)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=T.DIST.2T(1,10,3)")), CalcError::Value);
    }
}
