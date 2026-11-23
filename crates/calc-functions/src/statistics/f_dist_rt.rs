//! `F.DIST.RT(x, deg_freedom1, deg_freedom2)` — right-tailed F
//! probability `P(X >= x)` (legacy `FDIST`). Spec:
//! `docs/functions/F.DIST.RT.md`.
//!
//! Computed as `I_{1-z}(df2/2, df1/2)` directly
//! ([`super::f_dist::f_rt`]) so the far tail is not lost to
//! `1 - CDF` cancellation.

use super::f_dist::f_rt;
use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
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
    if x < 0.0
        || x.is_nan()
        || !super::chisq_dist::valid_df(df1)
        || !super::chisq_dist::valid_df(df2)
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = f_rt(x, df1, df2);
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
    fn spec_example_1pct() {
        let v = n(&eval("=F.DIST.RT(15.20686486,6,4)"));
        assert!((v - 0.01).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn spec_example_median() {
        assert_eq!(n(&eval("=F.DIST.RT(1,1,1)")), 0.5);
    }

    #[test]
    fn spec_example_table() {
        // F(2,10) upper tail at 2.8860466
        let v = n(&eval("=F.DIST.RT(2.8860466,2,10)"));
        assert!((v - 0.10245975784853645).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn negative_x_is_num() {
        assert_eq!(e(&eval("=F.DIST.RT(-1,2,3)")), CalcError::Num);
    }

    #[test]
    fn df_zero_is_num() {
        assert_eq!(e(&eval("=F.DIST.RT(1,0,3)")), CalcError::Num);
        assert_eq!(e(&eval("=F.DIST.RT(1,2,0)")), CalcError::Num);
    }

    #[test]
    fn df_above_bound_is_num() {
        assert_eq!(e(&eval("=F.DIST.RT(1,2,1E11)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=F.DIST.RT("x",2,3)"#)), CalcError::Value);
    }

    #[test]
    fn complements_left_tail() {
        let rt = n(&eval("=F.DIST.RT(2,4,9)"));
        let lt = n(&eval("=F.DIST(2,4,9,TRUE)"));
        assert!((rt + lt - 1.0).abs() < 1e-15, "rt={rt} lt={lt}");
    }

    #[test]
    fn at_zero_is_one() {
        assert_eq!(n(&eval("=F.DIST.RT(0,2,3)")), 1.0);
    }

    #[test]
    fn far_tail_positive() {
        let v = n(&eval("=F.DIST.RT(200,2,10)"));
        assert!(v > 0.0 && v < 0.01, "got {v}");
    }

    #[test]
    fn truncates_df() {
        let a = n(&eval("=F.DIST.RT(2,4.9,9.9)"));
        let b = n(&eval("=F.DIST.RT(2,4,9)"));
        assert_eq!(a, b);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=F.DIST.RT(1/0,2,3)")), CalcError::DivZero);
    }
}
