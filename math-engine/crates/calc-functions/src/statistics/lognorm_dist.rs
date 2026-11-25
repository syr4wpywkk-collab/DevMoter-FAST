//! `LOGNORM.DIST(x, mean, standard_dev, cumulative)` — lognormal
//! distribution of `ln(x) ~ N(mean, standard_dev)`.
//! Spec: `docs/functions/LOGNORM.DIST.md`.

use crate::common::{coercion, numerics};
use crate::statistics::phi::std_normal_pdf;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, slot) in nums.iter_mut().enumerate() {
        *slot = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [x, mean, sd] = nums;
    if x <= 0.0 || sd <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let z = (x.ln() - mean) / sd;
    Ok(Value::Number(if cumulative {
        numerics::normal_cdf(z)
    } else {
        std_normal_pdf(z) / (sd * x)
    }))
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
    fn doc_example_cdf() {
        assert!((n(&eval("=LOGNORM.DIST(4,3.5,1.2,TRUE)")) - 0.039083556).abs() < 1e-7);
    }

    #[test]
    fn doc_example_pdf() {
        assert!((n(&eval("=LOGNORM.DIST(4,3.5,1.2,FALSE)")) - 0.017617596).abs() < 1e-7);
    }

    #[test]
    fn median_is_half() {
        assert_eq!(n(&eval("=LOGNORM.DIST(1,0,1,TRUE)")), 0.5);
    }

    #[test]
    fn cdf_matches_standard() {
        // CDF at x = NORM.S.DIST((ln x - mu)/sigma).
        let z = (4.0f64.ln() - 3.5) / 1.2;
        let want = n(&eval(&format!("=NORM.S.DIST({z},TRUE)")));
        assert_eq!(n(&eval("=LOGNORM.DIST(4,3.5,1.2,TRUE)")), want);
    }

    #[test]
    fn x_zero_num() {
        assert_eq!(e(&eval("=LOGNORM.DIST(0,3.5,1.2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn x_negative_num() {
        assert_eq!(e(&eval("=LOGNORM.DIST(-1,3.5,1.2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn sd_nonpositive_num() {
        assert_eq!(e(&eval("=LOGNORM.DIST(4,3.5,0,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGNORM.DIST(4,3.5,-1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn cumulative_numeric_coercion() {
        assert_eq!(
            n(&eval("=LOGNORM.DIST(4,3.5,1.2,1)")),
            n(&eval("=LOGNORM.DIST(4,3.5,1.2,TRUE)"))
        );
    }

    #[test]
    fn text_value() {
        assert_eq!(
            e(&eval("=LOGNORM.DIST(\"x\",3.5,1.2,TRUE)")),
            CalcError::Value
        );
        assert_eq!(e(&eval("=LOGNORM.DIST(4,3.5,1.2,\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LOGNORM.DIST(1/0,0,1,TRUE)")), CalcError::DivZero);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(&[("A1", 4.0.into())], "=LOGNORM.DIST(A1,3.5,1.2,TRUE)");
        assert!((n(&v) - 0.039083556).abs() < 1e-7);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=LOGNORM.DIST(4,3.5,1.2)")), CalcError::Value);
    }
}
