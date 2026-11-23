//! `CHITEST(actual_range, expected_range)` — legacy chi-squared
//! independence/goodness-of-fit test; returns the right-tailed
//! p-value `P(χ² >= Σ (A-E)²/E)`; equivalent to `CHISQ.TEST`. Spec:
//! `docs/functions/CHITEST.md`.
//!
//! Degrees of freedom: `(r-1)(c-1)` for an `r × c` table with
//! `r,c > 1`; `n - 1` for a single row/column; a `1 × 1` input and
//! dimension mismatches are `#N/A`. Non-numeric cells are `#VALUE!`
//! (SPEC-OPEN resolution mirrors `CHISQ.TEST`) and `E = 0` ->
//! `#DIV/0!`.

use crate::common::{criteria, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let actual = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let expected = match criteria::eval_cells(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    if actual.rows() != expected.rows() || actual.cols() != expected.cols() {
        return Ok(Value::Error(CalcError::NA));
    }
    let (r, c) = (actual.rows() as usize, actual.cols() as usize);
    let df = match (r, c) {
        (1, 1) => return Ok(Value::Error(CalcError::NA)),
        (1, _) | (_, 1) => r.max(c) - 1,
        _ => (r - 1) * (c - 1),
    };
    let mut stat = 0.0;
    for i in 0..r * c {
        let a = &actual.cells()[i];
        let b = &expected.cells()[i];
        if let Some(e) = a.error().or_else(|| b.error()) {
            return Ok(Value::Error(e));
        }
        let (Value::Number(x), Value::Number(y)) = (a, b) else {
            return Ok(Value::Error(CalcError::Value));
        };
        if *y == 0.0 {
            return Ok(Value::Error(CalcError::DivZero));
        }
        let d = *x - *y;
        stat += d * d / *y;
    }
    let v = numerics::regularized_gamma_q(df as f64 / 2.0, stat / 2.0);
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
    fn spec_example_2x3() {
        // Microsoft docs example, df = (2-1)*(3-1) = 2.
        let v = n(&eval(
            "=CHITEST({58,11,10;35,25,23},{45.35,17.56,16.09;47.65,18.44,16.91})",
        ));
        assert!((v - 0.000308).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn spec_example_1d() {
        // stat = (10-15)²/15 + (20-15)²/15 = 3.3333, df = 1.
        let v = n(&eval("=CHITEST({10,20},{15,15})"));
        assert!((v - 0.06788915486182893).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn shape_mismatch_na() {
        assert_eq!(e(&eval("=CHITEST({1,2,3},{1,2})")), CalcError::NA);
    }

    #[test]
    fn single_cell_na() {
        assert_eq!(e(&eval("=CHITEST({5},{5})")), CalcError::NA);
    }

    #[test]
    fn expected_zero_div0() {
        assert_eq!(e(&eval("=CHITEST({1,2},{1,0})")), CalcError::DivZero);
    }

    #[test]
    fn identical_ranges_high_p() {
        // stat = 0 -> p-value = 1.
        assert_eq!(n(&eval("=CHITEST({3,4},{3,4})")), 1.0);
    }

    #[test]
    fn ranges_from_cells() {
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("A2", 20.0.into()),
                ("B1", 15.0.into()),
                ("B2", 15.0.into()),
            ],
            "=CHITEST(A1:A2,B1:B2)",
        );
        assert!((n(&v) - 0.06788915486182893).abs() < 1e-9, "got {v:?}");
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=CHITEST(A1:B1,{1,2})",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn text_cell_value() {
        let v = eval_with(
            &[("A1", "x".into()), ("A2", 2.0.into())],
            "=CHITEST(A1:A2,{1;2})",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=CHITEST({10,20},{15,15})"));
        let b = n(&eval("=CHISQ.TEST({10,20},{15,15})"));
        assert_eq!(a, b);
    }
}
