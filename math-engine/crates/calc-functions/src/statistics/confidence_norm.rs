//! `CONFIDENCE.NORM(alpha, standard_dev, size)` — half-width of the
//! normal-distribution confidence interval for a population mean:
//! `NORM.S.INV(1 - alpha/2) * standard_dev / SQRT(size)` (legacy
//! `CONFIDENCE`). Spec: `docs/functions/CONFIDENCE.NORM.md`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [alpha, sd, size] = nums;
    if alpha <= 0.0 || alpha >= 1.0 || sd <= 0.0 || size < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = numerics::normal_inv(1.0 - alpha / 2.0) * sd / size.trunc().sqrt();
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
    fn spec_example_005() {
        let v = n(&eval("=CONFIDENCE.NORM(0.05,2.5,50)"));
        assert!((v - 0.6929519121748391).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_001() {
        let v = n(&eval("=CONFIDENCE.NORM(0.01,1,100)"));
        assert!((v - 0.2575829303548903).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_size1() {
        // z(0.975) * 1 / 1
        let v = n(&eval("=CONFIDENCE.NORM(0.05,1,1)"));
        assert!((v - 1.959963984540054).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn alpha_zero_is_num() {
        assert_eq!(e(&eval("=CONFIDENCE.NORM(0,1,10)")), CalcError::Num);
    }

    #[test]
    fn alpha_one_is_num() {
        assert_eq!(e(&eval("=CONFIDENCE.NORM(1,1,10)")), CalcError::Num);
    }

    #[test]
    fn sd_zero_is_num() {
        assert_eq!(e(&eval("=CONFIDENCE.NORM(0.05,0,10)")), CalcError::Num);
        assert_eq!(e(&eval("=CONFIDENCE.NORM(0.05,-1,10)")), CalcError::Num);
    }

    #[test]
    fn size_below_one_is_num() {
        assert_eq!(e(&eval("=CONFIDENCE.NORM(0.05,1,0.5)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=CONFIDENCE.NORM("x",1,10)"#)), CalcError::Value);
    }

    #[test]
    fn truncates_size() {
        let a = n(&eval("=CONFIDENCE.NORM(0.05,1,50.9)"));
        let b = n(&eval("=CONFIDENCE.NORM(0.05,1,50)"));
        assert_eq!(a, b);
    }

    #[test]
    fn decreases_with_size() {
        let a = n(&eval("=CONFIDENCE.NORM(0.05,1,10)"));
        let b = n(&eval("=CONFIDENCE.NORM(0.05,1,100)"));
        assert!(a > b && b > 0.0);
    }

    #[test]
    fn decreases_with_smaller_alpha() {
        // Smaller alpha -> *larger* interval.
        let a = n(&eval("=CONFIDENCE.NORM(0.01,1,50)"));
        let b = n(&eval("=CONFIDENCE.NORM(0.05,1,50)"));
        assert!(a > b);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CONFIDENCE.NORM(1/0,1,10)")), CalcError::DivZero);
    }
}
