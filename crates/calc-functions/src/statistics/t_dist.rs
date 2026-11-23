//! `T.DIST(x, deg_freedom, cumulative)` — left-tailed Student's t
//! distribution. Spec: `docs/functions/T.DIST.md`.
//!
//! `deg_freedom` is truncated toward zero (Excel's documented df-arg
//! behavior); `df < 1` -> `#NUM!`. `x = 0` gives `0.5` exactly via the
//! shared [`numerics::t_cdf`]/[`numerics::t_pdf`] kernels. Legacy
//! `TDIST` is a different, positive-x-only function — not aliased.

use crate::common::{numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
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
    let cumulative = match ctx.eval(&args[2])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let v = if cumulative {
        numerics::t_cdf(x, df)
    } else {
        numerics::t_pdf(x, df)
    };
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
    fn excel_doc_cdf_example() {
        // Excel doc: T.DIST(60,1,TRUE) = 0.99469533
        let v = n(&eval("=T.DIST(60,1,TRUE)"));
        assert!((v - 0.9946953264).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn pdf_at_x8_df3() {
        // t_3 pdf at 8 = 0.000736907
        let v = n(&eval("=T.DIST(8,3,FALSE)"));
        assert!((v - 0.000736907).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn zero_gives_half() {
        assert_eq!(n(&eval("=T.DIST(0,10,TRUE)")), 0.5);
    }

    #[test]
    fn negative_x_left_tail() {
        // ~0.05: -t_{0.05,10}
        let v = n(&eval("=T.DIST(-1.812461,10,TRUE)"));
        assert!((v - 0.05).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn symmetry() {
        let a = n(&eval("=T.DIST(1.5,10,TRUE)"));
        let b = n(&eval("=T.DIST(-1.5,10,TRUE)"));
        assert!((a + b - 1.0).abs() < 1e-12, "{a} + {b}");
    }

    #[test]
    fn df_truncated() {
        // df 10.9 truncates to 10 -> equals T.DIST(-,10,TRUE)
        let a = n(&eval("=T.DIST(1,10.9,TRUE)"));
        let b = n(&eval("=T.DIST(1,10,TRUE)"));
        assert_eq!(a, b);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=T.DIST(1,0.5,TRUE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(e(&eval(r#"=T.DIST("x",10,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn non_numeric_df_value() {
        assert_eq!(e(&eval(r#"=T.DIST(1,"x",TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_cumulative_coerces() {
        // 1 -> TRUE, 0 -> FALSE
        assert_eq!(n(&eval("=T.DIST(0,10,1)")), 0.5);
        let pdf = n(&eval("=T.DIST(0,10,0)"));
        assert!(pdf > 0.3 && pdf < 0.4, "got {pdf}");
    }

    #[test]
    fn bad_cumulative_value() {
        assert_eq!(e(&eval(r#"=T.DIST(0,10,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T.DIST(1/0,10,TRUE)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=T.DIST(1,10)")), CalcError::Value);
    }
}
