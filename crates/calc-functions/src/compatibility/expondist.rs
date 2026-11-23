//! `EXPONDIST(x, lambda, cumulative)` — legacy exponential
//! distribution PDF `λe^(-λx)` or CDF `1 - e^(-λx)`; equivalent to
//! `EXPON.DIST`. Spec: `docs/functions/EXPONDIST.md`.
//!
//! The CDF uses `-exp_m1(-λx)` so `1 - e^u` keeps its digits near
//! `u = 0`; the PDF is the direct closed form.

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
    fn spec_example_cdf() {
        // 1 - e^-2
        let v = n(&eval("=EXPONDIST(0.2,10,TRUE)"));
        assert!((v - 0.8646647168).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_pdf() {
        // 10 * e^-2
        let v = n(&eval("=EXPONDIST(0.2,10,FALSE)"));
        assert!((v - 1.353352832).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn cdf_at_zero() {
        assert_eq!(n(&eval("=EXPONDIST(0,10,TRUE)")), 0.0);
    }

    #[test]
    fn pdf_at_zero_is_lambda() {
        assert_eq!(n(&eval("=EXPONDIST(0,10,FALSE)")), 10.0);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=EXPONDIST(-0.1,10,TRUE)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_lambda_num() {
        assert_eq!(e(&eval("=EXPONDIST(0.2,0,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=EXPONDIST(0.2,-1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn large_x_underflows_to_zero() {
        assert_eq!(n(&eval("=EXPONDIST(1000,10,FALSE)")), 0.0);
        assert_eq!(n(&eval("=EXPONDIST(1000,10,TRUE)")), 1.0);
    }

    #[test]
    fn cumulative_numeric_zero_is_false() {
        assert_eq!(n(&eval("=EXPONDIST(0,10,0)")), 10.0);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=EXPONDIST("x",10,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        let v = n(&eval(r#"=EXPONDIST("0.2",10,TRUE)"#));
        assert!((v - 0.8646647168).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=EXPONDIST(1.5,2,FALSE)"));
        let b = n(&eval("=EXPON.DIST(1.5,2,FALSE)"));
        assert_eq!(a, b);
    }
}
