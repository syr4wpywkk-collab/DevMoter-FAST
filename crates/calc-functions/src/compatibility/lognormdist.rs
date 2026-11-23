//! `LOGNORMDIST(x, mean, standard_dev)` — legacy cumulative lognormal
//! distribution `NORMSDIST((ln(x) - mean) / standard_dev)`; equivalent
//! to `LOGNORM.DIST(x, mean, sd, TRUE)`. Spec:
//! `docs/functions/LOGNORMDIST.md`.

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
    Ok(Value::Number(numerics::normal_cdf((x.ln() - mean) / sd)))
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
    fn spec_example() {
        let v = n(&eval("=LOGNORMDIST(4,3.5,1.2)"));
        assert!((v - 0.039084).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn median_is_half() {
        assert_eq!(n(&eval("=LOGNORMDIST(1,0,1)")), 0.5);
    }

    #[test]
    fn spec_median() {
        let v = n(&eval("=LOGNORMDIST(33.11545196,3.5,1.2)"));
        assert!((v - 0.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn x_zero_num() {
        assert_eq!(e(&eval("=LOGNORMDIST(0,3.5,1.2)")), CalcError::Num);
    }

    #[test]
    fn x_negative_num() {
        assert_eq!(e(&eval("=LOGNORMDIST(-1,3.5,1.2)")), CalcError::Num);
    }

    #[test]
    fn sd_nonpositive_num() {
        assert_eq!(e(&eval("=LOGNORMDIST(4,3.5,0)")), CalcError::Num);
        assert_eq!(e(&eval("=LOGNORMDIST(4,3.5,-1)")), CalcError::Num);
    }

    #[test]
    fn large_x_near_one() {
        let v = n(&eval("=LOGNORMDIST(1e6,0,1)"));
        assert!(v > 0.9999, "got {v}");
    }

    #[test]
    fn small_x_near_zero() {
        let v = n(&eval("=LOGNORMDIST(1e-6,0,1)"));
        assert!(v < 1e-4, "got {v}");
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=LOGNORMDIST("x",0,1)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        assert_eq!(n(&eval(r#"=LOGNORMDIST("1",0,1)"#)), 0.5);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=LOGNORMDIST(2.5,1,0.5)"));
        let b = n(&eval("=LOGNORM.DIST(2.5,1,0.5,TRUE)"));
        assert_eq!(a, b);
    }
}
