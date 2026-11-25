//! `FTEST(array1, array2)` — legacy two-tailed p-value of the F-test
//! for equal variances: `2 * min(F_cdf(r), 1 - F_cdf(r))` at the
//! observed variance ratio `r = s1² / s2²`; equivalent to `F.TEST`.
//! Spec: `docs/functions/FTEST.md`.
//!
//! Arrays may differ in length; members follow the array-argument
//! rule (non-numeric ignored, errors propagate). Fewer than two
//! numerics in either array or a zero sample variance is `#DIV/0!`.

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
    fn spec_example() {
        let v = n(&eval("=FTEST({6,7,9,15,21},{20,28,31,38,40})"));
        assert!((v - 0.648318).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn equal_arrays_give_one() {
        let v = n(&eval(
            "=FTEST({1,2,3,4,5,6,7,8,9,10},{1,2,3,4,5,6,7,8,9,10})",
        ));
        assert!((v - 1.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn zero_variance_div0() {
        assert_eq!(e(&eval("=FTEST({1,1,1},{2,3,4})")), CalcError::DivZero);
    }

    #[test]
    fn too_few_values_div0() {
        assert_eq!(e(&eval("=FTEST({1},{1,2,3})")), CalcError::DivZero);
    }

    #[test]
    fn different_sizes_allowed() {
        // Mirrors the F.TEST spec example: r = 0.15, F(2,3).
        let v = n(&eval("=FTEST({1,2,3},{2,4,6,8})"));
        assert!((v - 0.2664316559171049).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn ranges_from_cells() {
        let v = eval_with(
            &[
                ("A1", 6.0.into()),
                ("A2", 7.0.into()),
                ("A3", 9.0.into()),
                ("B1", 20.0.into()),
                ("B2", 28.0.into()),
                ("B3", 31.0.into()),
            ],
            "=FTEST(A1:A3,B1:B3)",
        );
        assert!(matches!(v, Value::Number(_)), "got {v:?}");
    }

    #[test]
    fn text_members_ignored() {
        let a = eval_with(&[("A1", "x".into())], "=FTEST({A1,1,2,3},{2,4,6,8})");
        let b = eval("=FTEST({1,2,3},{2,4,6,8})");
        assert_eq!(a, b);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=FTEST({A1,1,2},{2,3,4})",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn result_in_unit_interval() {
        let v = n(&eval("=FTEST({1,5,9,2,7},{3,3,4,5,8,8,1})"));
        assert!((0.0..=1.0).contains(&v), "got {v}");
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=FTEST({6,7,9,15,21},{20,28,31,38,40})"));
        let b = n(&eval("=F.TEST({6,7,9,15,21},{20,28,31,38,40})"));
        assert_eq!(a, b);
    }
}
