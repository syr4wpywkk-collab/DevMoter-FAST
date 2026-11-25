//! `PROB(x_range, prob_range, lower_limit, [upper_limit])` — probability
//! that values in `x_range` fall within the bounds.
//! Spec: `docs/functions/PROB.md`.
//!
//! Every `prob_range` cell must be numeric in `[0,1]` and the
//! probabilities must sum to `1` (`#NUM!` otherwise — PROB is stricter
//! than the aggregates here). A non-numeric `x_range` cell excludes its
//! position from the sum (SPEC-OPEN in the spec doc: text/blank in
//! `x_range` may instead error). Sum-vs-1 uses an absolute tolerance of
//! `1e-9` (the spec's tolerance question is SPEC-OPEN).

use crate::common::criteria;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

const SUM_TOL: f64 = 1e-9;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 4) {
        return Ok(Value::Error(e));
    }
    let xs = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let ps = match criteria::eval_cells(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    if xs.len() != ps.len() {
        return Ok(Value::Error(CalcError::NA));
    }
    let lo = match statistics::scalar_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let hi = match args.get(3) {
        None => None,
        Some(arg) => match statistics::scalar_number(ctx, arg)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => Some(v),
        },
    };

    let mut sum = 0.0;
    for p in ps.cells() {
        match p {
            Value::Number(v) if (0.0..=1.0).contains(v) => sum += v,
            Value::Number(_) => return Ok(Value::Error(CalcError::Num)),
            Value::Error(e) => return Ok(Value::Error(*e)),
            // Non-numeric prob cells are `#NUM!` (see module doc).
            _ => return Ok(Value::Error(CalcError::Num)),
        }
    }
    if (sum - 1.0).abs() > SUM_TOL {
        return Ok(Value::Error(CalcError::Num));
    }

    let mut total = 0.0;
    for (x, p) in xs.cells().iter().zip(ps.cells()) {
        let Value::Number(x) = x else {
            if let Value::Error(e) = x {
                return Ok(Value::Error(*e));
            }
            continue; // non-numeric x: position contributes nothing
        };
        let Value::Number(p) = p else { unreachable!() };
        let inside = match hi {
            Some(h) => *x >= lo && *x <= h,
            None => *x == lo,
        };
        if inside {
            total += p;
        }
    }
    Ok(Value::Number(total))
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

    fn base() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 0.0.into()),
            ("A2", 1.0.into()),
            ("A3", 2.0.into()),
            ("A4", 3.0.into()),
            ("B1", 0.2.into()),
            ("B2", 0.3.into()),
            ("B3", 0.1.into()),
            ("B4", 0.4.into()),
        ]
    }

    #[test]
    fn doc_example_point() {
        assert_eq!(n(&eval_with(&base(), "=PROB(A1:A4,B1:B4,2)")), 0.1);
    }

    #[test]
    fn doc_example_range() {
        assert_eq!(n(&eval_with(&base(), "=PROB(A1:A4,B1:B4,1,3)")), 0.8);
    }

    #[test]
    fn doc_example_bad_sum_num() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 0.5.into()),
                ("B2", 0.5.into()),
                ("B3", 0.5.into()),
            ],
            "=PROB(A1:A3,B1:B3,1,2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_prob_num() {
        let mut c = base();
        c[4].1 = (-0.2).into();
        c[5].1 = 0.7.into();
        assert_eq!(e(&eval_with(&c, "=PROB(A1:A4,B1:B4,1,3)")), CalcError::Num);
    }

    #[test]
    fn prob_above_one_num() {
        let mut c = base();
        c[4].1 = 1.2.into();
        assert_eq!(e(&eval_with(&c, "=PROB(A1:A4,B1:B4,1,3)")), CalcError::Num);
    }

    #[test]
    fn size_mismatch_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("B1", 1.0.into())],
            "=PROB(A1:A2,B1:B1,1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn missing_value_point() {
        assert_eq!(n(&eval_with(&base(), "=PROB(A1:A4,B1:B4,7)")), 0.0);
    }

    #[test]
    fn bounds_inclusive() {
        // lower=0 upper=3 covers everything -> 1.
        assert_eq!(n(&eval_with(&base(), "=PROB(A1:A4,B1:B4,0,3)")), 1.0);
    }

    #[test]
    fn text_prob_cell_num() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", "x".into())],
            "=PROB(A1:A1,B1:B1,1)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn error_cells_propagate() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::DivZero)),
                ("B1", 0.5.into()),
                ("B2", 0.5.into()),
            ],
            "=PROB(A1:A2,B1:B2,0,2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn nonnumeric_bounds_value() {
        assert_eq!(
            e(&eval_with(&base(), r#"=PROB(A1:A4,B1:B4,"x")"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&base(), r#"=PROB(A1:A4,B1:B4,1,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn duplicate_x_each_contributes() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", 2.0.into()),
                ("B1", 0.4.into()),
                ("B2", 0.6.into()),
            ],
            "=PROB(A1:A2,B1:B2,2)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=PROB(A1:A2,B1:B2)")), CalcError::Value);
    }
}
