//! `CHISQ.DIST.RT(x, deg_freedom)` — right-tailed chi-squared
//! probability `P(X >= x)` (legacy `CHIDIST`). Spec:
//! `docs/functions/CHISQ.DIST.RT.md`.
//!
//! Uses the *upper* regularized gamma `Q(df/2, x/2)` directly so the
//! far tail keeps its digits where `1 - P` would round to zero.

use super::chisq_dist::{chisq_rt, valid_df};
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
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let df = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if x < 0.0 || x.is_nan() || !valid_df(df) {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = chisq_rt(x, df);
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
    fn spec_example_df10() {
        let v = n(&eval("=CHISQ.DIST.RT(18.307,10)"));
        assert!((v - 0.05).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn spec_example_df1() {
        let v = n(&eval("=CHISQ.DIST.RT(0.5,1)"));
        assert!((v - 0.4795001221869535).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_upper_5pct() {
        let v = n(&eval("=CHISQ.DIST.RT(3.841,1)"));
        assert!((v - 0.05).abs() < 1e-3, "got {v}");
    }

    #[test]
    fn complements_left_tail() {
        let rt = n(&eval("=CHISQ.DIST.RT(5,4)"));
        let lt = n(&eval("=CHISQ.DIST(5,4,TRUE)"));
        assert!((rt + lt - 1.0).abs() < 1e-15, "rt={rt} lt={lt}");
    }

    #[test]
    fn negative_x_is_num() {
        assert_eq!(e(&eval("=CHISQ.DIST.RT(-1,3)")), CalcError::Num);
    }

    #[test]
    fn df_zero_is_num() {
        assert_eq!(e(&eval("=CHISQ.DIST.RT(2,0)")), CalcError::Num);
    }

    #[test]
    fn df_above_bound_is_num() {
        assert_eq!(e(&eval("=CHISQ.DIST.RT(2,1E11)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=CHISQ.DIST.RT("x",3)"#)), CalcError::Value);
    }

    #[test]
    fn truncates_df() {
        let a = n(&eval("=CHISQ.DIST.RT(5,4.9)"));
        let b = n(&eval("=CHISQ.DIST.RT(5,4)"));
        assert_eq!(a, b);
    }

    #[test]
    fn at_zero_is_one() {
        assert_eq!(n(&eval("=CHISQ.DIST.RT(0,3)")), 1.0);
    }

    #[test]
    fn far_tail_positive() {
        // Well past the median: a small but strictly positive tail.
        let v = n(&eval("=CHISQ.DIST.RT(60,10)"));
        assert!((0.0..1e-8).contains(&v), "got {v}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CHISQ.DIST.RT(1/0,3)")), CalcError::DivZero);
    }
}
