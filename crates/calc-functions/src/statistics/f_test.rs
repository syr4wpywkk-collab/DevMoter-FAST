//! `F.TEST(array1, array2)` — two-tailed p-value of the F-test for
//! equal variances: `2 * min(F_cdf(r), 1 - F_cdf(r))` at the observed
//! variance ratio `r = s1² / s2²`. Spec: `docs/functions/F.TEST.md`.
//!
//! Arrays may differ in length; members follow the array-argument rule
//! (non-numeric ignored, errors propagate). Fewer than two numerics in
//! either array or a zero sample variance is `#DIV/0!` (the spec's
//! error-kind question chooses the documented value).

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
    let a = match statistics::array_numbers(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let b = match statistics::array_numbers(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let (s1, s2) = match (
        statistics::sample_variance(&a),
        statistics::sample_variance(&b),
    ) {
        (Some(s1), Some(s2)) if s1 > 0.0 && s2 > 0.0 => (s1, s2),
        _ => return Ok(Value::Error(CalcError::DivZero)),
    };
    let r = s1 / s2;
    let d1 = (a.len() - 1) as f64;
    let d2 = (b.len() - 1) as f64;
    let cdf = numerics::f_cdf(r, d1, d2);
    if cdf.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(2.0 * cdf.min(1.0 - cdf)))
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
    fn equal_variances_give_one() {
        // Same sample variance -> r = 1 -> symmetric F(3,3) CDF 0.5 -> p = 1.
        assert!((n(&eval("=F.TEST({6,8,10,12},{4,6,8,10})")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn unequal_variances() {
        // r = 0.15, F(2,3): 2*cdf(0.15) = 0.26643...
        assert!((n(&eval("=F.TEST({1,2,3},{2,4,6,8})")) - 0.2664316559171049).abs() < 1e-12);
    }

    #[test]
    fn quarter_ratio() {
        // s1²/s2² = 1/4, F(4,4): p = 0.208.
        assert!((n(&eval("=F.TEST({1,2,3,4,5},{2,4,6,8,10})")) - 0.208).abs() < 1e-12);
    }

    #[test]
    fn different_lengths_ok() {
        let v = eval("=F.TEST({1,2,3,4},{2,4,6})");
        assert!(matches!(v, Value::Number(_)), "{v:?}");
    }

    #[test]
    fn too_few_numeric_div_zero() {
        assert_eq!(e(&eval("=F.TEST({5},{1,2})")), CalcError::DivZero);
    }

    #[test]
    fn zero_variance_div_zero() {
        assert_eq!(e(&eval("=F.TEST({5,5,5},{1,2,3})")), CalcError::DivZero);
        assert_eq!(e(&eval("=F.TEST({1,2,3},{5,5,5})")), CalcError::DivZero);
    }

    #[test]
    fn ranges_ignore_text() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", "x".into()),
                ("A4", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
            ],
            "=F.TEST(A1:A4,B1:B3)",
        );
        assert!((n(&v) - 0.4).abs() < 1e-12);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::NA)),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=F.TEST(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn range_form() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
                ("B4", 8.0.into()),
            ],
            "=F.TEST(A1:A3,B1:B4)",
        );
        assert!((n(&v) - 0.2664316559171049).abs() < 1e-12);
    }

    #[test]
    fn symmetric_in_arguments() {
        // Swapping the arrays flips r -> same two-tailed p.
        let p1 = n(&eval("=F.TEST({1,2,3},{2,4,6,8})"));
        let p2 = n(&eval("=F.TEST({2,4,6,8},{1,2,3})"));
        assert!((p1 - p2).abs() < 1e-12, "{p1} vs {p2}");
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=F.TEST({1,2})")), CalcError::Value);
    }
}
