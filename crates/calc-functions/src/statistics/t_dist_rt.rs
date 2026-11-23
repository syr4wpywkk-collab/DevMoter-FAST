//! `T.DIST.RT(x, deg_freedom)` — right-tailed t probability
//! `P(T >= x)`. Spec: `docs/functions/T.DIST.RT.md`.
//!
//! Uses the upper-tail incomplete-beta kernel [`numerics::t_sf`] so the
//! far right tail keeps precision (a literal `1 - T.DIST` would
//! collapse to 0). `deg_freedom` truncated; `df < 1` -> `#NUM!`.

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
    let df = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc(),
    };
    if df < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(numerics::t_sf(x, df)))
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
        // Excel doc: T.DIST.RT(1.959999998,60) = 0.027322
        let v = n(&eval("=T.DIST.RT(1.959999998,60)"));
        assert!((v - 0.0273224649).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn zero_gives_half() {
        assert_eq!(n(&eval("=T.DIST.RT(0,10)")), 0.5);
    }

    #[test]
    fn negative_x_above_half() {
        let v = n(&eval("=T.DIST.RT(-1.812461,10)"));
        assert!((v - 0.95).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn complements_left_tail() {
        // RT(x) + T.DIST(x,df,TRUE) = 1 even in the far tail.
        let rt = n(&eval("=T.DIST.RT(8,3)"));
        let cdf = n(&eval("=T.DIST(8,3,TRUE)"));
        assert!((rt + cdf - 1.0).abs() < 1e-12, "{rt} + {cdf}");
    }

    #[test]
    fn far_right_tail_nonzero() {
        let v = n(&eval("=T.DIST.RT(50,5)"));
        assert!(v > 0.0 && v < 1e-5, "got {v}");
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=T.DIST.RT(1,10.9)"));
        let b = n(&eval("=T.DIST.RT(1,10)"));
        assert_eq!(a, b);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=T.DIST.RT(1,0.5)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(e(&eval(r#"=T.DIST.RT("x",10)"#)), CalcError::Value);
    }

    #[test]
    fn non_numeric_df_value() {
        assert_eq!(e(&eval(r#"=T.DIST.RT(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn range_df_value() {
        // A range arg coerces to a scalar via implicit intersection or
        // fails; a multi-cell range is #VALUE! under scalar coercion.
        let v = eval_with(&[("A1", 1.0.into())], "=T.DIST.RT(1,A1)");
        assert_eq!(n(&v), n(&eval("=T.DIST.RT(1,1)")));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T.DIST.RT(1/0,10)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=T.DIST.RT(1)")), CalcError::Value);
    }
}
