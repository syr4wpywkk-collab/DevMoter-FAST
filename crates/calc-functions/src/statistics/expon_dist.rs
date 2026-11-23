//! `EXPON.DIST(x, lambda, cumulative)` — exponential distribution PDF
//! `λe^(-λx)` or CDF `1 - e^(-λx)` (legacy `EXPONDIST`). Spec:
//! `docs/functions/EXPON.DIST.md`.
//!
//! The CDF uses `-exp_m1(-λx)` (`1 - e^u` computed without rounding to
//! 1 near `u = 0`); the PDF is the direct closed form.

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
    let lambda = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let cumulative = match ctx.eval(&args[2])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    if x < 0.0 || x.is_nan() || lambda <= 0.0 || lambda.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    let u = -lambda * x;
    let v = if cumulative {
        -u.exp_m1()
    } else {
        lambda * u.exp()
    };
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
    fn cdf_spec_example() {
        let v = n(&eval("=EXPON.DIST(0.2,10,TRUE)"));
        assert!((v - 0.8646647167633873).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn pdf_spec_example() {
        let v = n(&eval("=EXPON.DIST(0.2,10,FALSE)"));
        assert!((v - 1.353352832366127).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn pdf_at_zero_is_lambda() {
        assert_eq!(n(&eval("=EXPON.DIST(0,1,FALSE)")), 1.0);
        assert_eq!(n(&eval("=EXPON.DIST(0,10,FALSE)")), 10.0);
    }

    #[test]
    fn cdf_at_zero_is_zero() {
        assert_eq!(n(&eval("=EXPON.DIST(0,1,TRUE)")), 0.0);
    }

    #[test]
    fn negative_x_is_num() {
        assert_eq!(e(&eval("=EXPON.DIST(-1,1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn lambda_zero_is_num() {
        assert_eq!(e(&eval("=EXPON.DIST(1,0,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=EXPON.DIST(1,-2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=EXPON.DIST("x",1,TRUE)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=EXPON.DIST(1,"x",TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn cdf_monotone() {
        let a = n(&eval("=EXPON.DIST(0.5,1,TRUE)"));
        let b = n(&eval("=EXPON.DIST(1.5,1,TRUE)"));
        assert!(a < b && b < 1.0);
    }

    #[test]
    fn pdf_integrates_consistently() {
        // Rough check: CDF(x) approx integral of PDF — midpoint rule
        // sanity on one cell.
        let cdf = n(&eval("=EXPON.DIST(1,1,TRUE)"));
        let pdf_mid = n(&eval("=EXPON.DIST(0.5,1,FALSE)"));
        assert!((cdf - pdf_mid).abs() < 0.2, "cdf={cdf} mid={pdf_mid}");
    }

    #[test]
    fn tiny_x_cdf_accurate() {
        // 1 - e^-1e-9 ≈ 1e-9; naive 1-exp would round to 0.
        let v = n(&eval("=EXPON.DIST(0.000000001,1,TRUE)"));
        assert!((v - 1e-9).abs() < 1e-15, "got {v}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=EXPON.DIST(1/0,1,TRUE)")), CalcError::DivZero);
    }
}
