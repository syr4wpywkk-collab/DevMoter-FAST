//! `INTERCEPT(known_ys, known_xs)` — regression intercept `ȳ - b·x̄`
//! where `b` is the `SLOPE`. Spec: `docs/functions/INTERCEPT.md`.
//!
//! Same pairing and error rules as `SLOPE`: non-numeric members drop
//! the pair; fewer than 2 pairs or zero x-variance is `#DIV/0!`;
//! member-count mismatch is `#N/A`.

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
    let b = st.sxy / st.sxx;
    Ok(Value::Number(st.mean_y - b * st.mean_x))
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
    fn zero_intercept() {
        // ys {1,2,3} on xs {2,4,6}: b=0.5, a = 2 - 0.5*4 = 0
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
            ],
            "=INTERCEPT(A1:A3,B1:B3)",
        );
        assert!((n(&v)).abs() < 1e-15);
    }

    #[test]
    fn nonzero_intercept() {
        // ys {2,4,6} on xs {1,2,3}: b=2, a = 4 - 2*2 = 0... use offset:
        // ys {3,5,7}: b=2, a = 5 - 2*2 = 1
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 7.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=INTERCEPT(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn non_perfect_fit() {
        // xs {1,2,3}, ys {1,2,2}: b=0.5, x̄=2, ȳ=5/3 -> a = 5/3 - 1 = 2/3
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=INTERCEPT(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 2.0 / 3.0).abs() < 1e-15);
    }

    #[test]
    fn consistent_with_slope() {
        // a = ȳ - b·x̄ for the same data.
        let cells: &[(&str, Value)] = &[
            ("A1", 1.0.into()),
            ("A2", 3.0.into()),
            ("A3", 2.0.into()),
            ("B1", 2.0.into()),
            ("B2", 5.0.into()),
            ("B3", 4.0.into()),
        ];
        let a = n(&eval_with(cells, "=INTERCEPT(A1:A3,B1:B3)"));
        let b = n(&eval_with(cells, "=SLOPE(A1:A3,B1:B3)"));
        let mx = (2.0 + 5.0 + 4.0) / 3.0;
        let my = (1.0 + 3.0 + 2.0) / 3.0;
        assert!((a - (my - b * mx)).abs() < 1e-12);
    }

    #[test]
    fn non_numeric_pair_dropped() {
        // B2 text: pair 2 dropped; pairs (x,y)=(2,3),(3,7) -> b=4,a=-5
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 7.0.into()),
                ("B1", 2.0.into()),
                ("B2", "x".into()),
                ("B3", 3.0.into()),
            ],
            "=INTERCEPT(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), -5.0);
    }

    #[test]
    fn size_mismatch_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into()), ("B2", 2.0.into())],
            "=INTERCEPT(A1:A1,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn fewer_than_two_pairs_div_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into())],
            "=INTERCEPT(A1:A1,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn vertical_data_div_zero() {
        // All x equal -> #DIV/0!, not infinity.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 5.0.into()),
                ("B2", 5.0.into()),
            ],
            "=INTERCEPT(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::Ref)),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=INTERCEPT(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn blank_pair_dropped() {
        // A2 blank (y): pairs (x,y)=(1,1),(3,3) -> b=1, a=0.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", 9.0.into()),
                ("B3", 3.0.into()),
            ],
            "=INTERCEPT(A1:A3,B1:B3)",
        );
        assert!((n(&v)).abs() < 1e-15);
    }
}
