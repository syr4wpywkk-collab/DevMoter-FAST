//! `BETADIST(x, alpha, beta, [A], [B])` — legacy cumulative beta
//! distribution `I((x-A)/(B-A), alpha, beta)` on `[A,B]` (default
//! `[0,1]`); equivalent to `BETA.DIST(..., TRUE, A, B)`. Spec:
//! `docs/functions/BETADIST.md`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [x, alpha, beta] = nums;
    let (mut lo, mut hi) = (0.0, 1.0);
    for (i, out) in [(3, &mut lo), (4, &mut hi)] {
        if args.len() > i {
            *out = match coercion::eval_number(ctx, &args[i])? {
                Err(e) => return Ok(Value::Error(e)),
                Ok(v) => v,
            };
        }
    }

    if alpha <= 0.0 || beta <= 0.0 || lo == hi {
        return Ok(Value::Error(CalcError::Num));
    }
    let z = (x - lo) / (hi - lo);
    if !(0.0..=1.0).contains(&z) {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = numerics::regularized_beta(z, alpha, beta);
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
    fn spec_example_half() {
        assert!((n(&eval("=BETADIST(0.5,2,2)")) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn spec_example_three_quarter() {
        // CDF 3x^2 - 2x^3 at 0.75 = 0.84375.
        let v = n(&eval("=BETADIST(0.75,2,2)"));
        assert!((v - 0.84375).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_with_bounds() {
        // I_{0.6}(2,3) = 6x^2 - 8x^3 + 3x^4 = 0.8208 exactly (the spec
        // doc's printed 0.68256 is incorrect).
        let v = n(&eval("=BETADIST(8,2,3,5,10)"));
        assert!((v - 0.8208).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=BETADIST(0.4,3,5)"));
        let b = n(&eval("=BETA.DIST(0.4,3,5,TRUE)"));
        assert_eq!(a, b);
    }

    #[test]
    fn endpoints() {
        assert_eq!(n(&eval("=BETADIST(0,2,3)")), 0.0);
        assert_eq!(n(&eval("=BETADIST(1,2,3)")), 1.0);
    }

    #[test]
    fn x_outside_interval_num() {
        assert_eq!(e(&eval("=BETADIST(-0.5,2,2)")), CalcError::Num);
        assert_eq!(e(&eval("=BETADIST(1.5,2,2)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_shape_num() {
        assert_eq!(e(&eval("=BETADIST(0.5,0,2)")), CalcError::Num);
        assert_eq!(e(&eval("=BETADIST(0.5,2,-1)")), CalcError::Num);
    }

    #[test]
    fn a_equals_b_num() {
        assert_eq!(e(&eval("=BETADIST(1,2,2,1,1)")), CalcError::Num);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=BETADIST("x",2,2)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        let v = n(&eval(r#"=BETADIST("0.5",2,2)"#));
        assert!((v - 0.5).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn boolean_coerced() {
        // TRUE -> 1 -> CDF at the upper bound.
        assert_eq!(n(&eval("=BETADIST(TRUE,2,2)")), 1.0);
    }
}
