//! `SLOPE(known_ys, known_xs)` — least-squares regression slope
//! `Σ((x-x̄)(y-ȳ)) / Σ((x-x̄)²)`. Spec: `docs/functions/SLOPE.md`.
//!
//! Pairs are dropped when either member is non-numeric; fewer than 2
//! surviving pairs or zero x-variance is `#DIV/0!`; member-count
//! mismatch is `#N/A`.

use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    // Argument order in the spec is (ys, xs); pair_stats takes (x, y).
    let pairs = match statistics::numeric_pairs(ctx, &args[1], &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    if pairs.len() < 2 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let st = statistics::pair_stats(&pairs);
    if st.sxx == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(st.sxy / st.sxx))
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
    fn basic_slope() {
        // ys {1,2,3} on xs {2,4,6} -> 0.5
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
            ],
            "=SLOPE(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 0.5);
    }

    #[test]
    fn slope_one() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=SLOPE(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn negative_slope() {
        // ys {6,4,2} on xs {1,2,3} -> -2
        let v = eval_with(
            &[
                ("A1", 6.0.into()),
                ("A2", 4.0.into()),
                ("A3", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=SLOPE(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), -2.0);
    }

    #[test]
    fn non_perfect_fit() {
        // xs {1,2,3}, ys {1,2,2}: x̄=2 ȳ=5/3; sxy=(−1)(−2/3)+0+(1)(1/3)=1
        // sxx=2 -> 0.5
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=SLOPE(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn non_numeric_pair_dropped() {
        // B2 text: pair 2 dropped; pairs (x2,y2)=(2,1),(6,3) -> slope .5
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", "x".into()),
                ("B3", 6.0.into()),
            ],
            "=SLOPE(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 0.5);
    }

    #[test]
    fn size_mismatch_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into()), ("B2", 2.0.into())],
            "=SLOPE(A1:A1,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn fewer_than_two_pairs_div_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into())],
            "=SLOPE(A1:A1,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn zero_x_variance_div_zero() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 5.0.into()),
                ("B2", 5.0.into()),
            ],
            "=SLOPE(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::NA)),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=SLOPE(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn blank_pair_dropped() {
        // A2 blank (y side): pairs (1,1),(3,3) -> slope 1.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", 9.0.into()),
                ("B3", 3.0.into()),
            ],
            "=SLOPE(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 1.0);
    }
}
