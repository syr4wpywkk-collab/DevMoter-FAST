//! `CHISQ.TEST(actual_range, expected_range)` — chi-squared
//! independence/goodness-of-fit test; returns the right-tailed p-value
//! `P(χ² >= Σ (A-E)²/E)` (legacy `CHITEST`). Spec:
//! `docs/functions/CHISQ.TEST.md`.
//!
//! Degrees of freedom: `(r-1)(c-1)` for an `r × c` table with
//! `r,c > 1`; `n - 1` for a single row/column; undefined (and
//! dimension mismatches) -> `#N/A`. Non-numeric cells are `#VALUE!`
//! (SPEC-OPEN — Excel's treatment of text/blank inside the ranges is
//! not pinned) and `E = 0` -> `#DIV/0!`.

use super::chisq_dist::chisq_rt;
use crate::common::criteria;
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
    let v = chisq_rt(stat, df as f64);
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
    fn spec_example_2x2() {
        // statistic ≈ 8.0018, df = 1 -> p ≈ 0.004683
        let v = n(&eval(
            "=CHISQ.TEST({58,35;11,25},{45.22,47.78;23.78,25.22})",
        ));
        assert!((v - 0.00019275405427950058).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_row() {
        // statistic = 10, df = 2, p = CHISQ.DIST.RT(10,2) = e^-5
        let v = n(&eval("=CHISQ.TEST({10,20,30},{20,20,20})"));
        assert!((v - 0.006737946999085467).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn identical_gives_one() {
        assert_eq!(n(&eval("=CHISQ.TEST({5,10},{5,10})")), 1.0);
    }

    #[test]
    fn dimension_mismatch_is_na() {
        assert_eq!(e(&eval("=CHISQ.TEST({1,2},{1,2,3})")), CalcError::NA);
    }

    #[test]
    fn single_cell_is_na() {
        assert_eq!(e(&eval("=CHISQ.TEST({1},{1})")), CalcError::NA);
    }

    #[test]
    fn zero_expected_is_divzero() {
        assert_eq!(e(&eval("=CHISQ.TEST({1,2},{0,2})")), CalcError::DivZero);
    }

    #[test]
    fn ranges_from_cells() {
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("A2", 20.0.into()),
                ("A3", 30.0.into()),
                ("B1", 20.0.into()),
                ("B2", 20.0.into()),
                ("B3", 20.0.into()),
            ],
            "=CHISQ.TEST(A1:A3,B1:B3)",
        );
        let v = n(&v);
        assert!((v - 0.006737946999085467).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn non_numeric_cell_is_value() {
        assert_eq!(e(&eval(r#"=CHISQ.TEST({1,"x"},{1,2})"#)), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref)), ("A2", 2.0.into())],
            "=CHISQ.TEST(A1:A2,{1;2})",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn column_vector_df() {
        // {10,20,30} as a column: same statistic/df as the row case.
        let v = n(&eval("=CHISQ.TEST({10;20;30},{20;20;20})"));
        assert!((v - 0.006737946999085467).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn small_p_value() {
        // Strong disagreement: tiny but positive p.
        let v = n(&eval("=CHISQ.TEST({100,1},{1,100})"));
        assert!((0.0..1e-20).contains(&v), "got {v}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CHISQ.TEST({1,2},1/0)")), CalcError::DivZero);
    }
}
