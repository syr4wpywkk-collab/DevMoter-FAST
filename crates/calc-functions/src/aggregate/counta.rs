//! `COUNTA(value1, [value2], ...)` — counts non-empty values.
//! Spec: `docs/functions/COUNTA.md`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let flat = coercion::flatten_args(ctx, args)?;
    let mut count = 0u64;
    for (v, ranged) in flat {
        if ranged {
            // Blank cells are not counted; everything else is, including
            // Text("") and error cells.
            if !v.is_blank() {
                count += 1;
            }
        } else {
            // SPEC-OPEN (P1-COUNTA-010): an error produced inside an
            // argument expression is propagated rather than counted;
            // Excel's exact behavior is unverified.
            if let Some(e) = v.error() {
                return Ok(Value::Error(e));
            }
            count += 1;
        }
    }
    Ok(Value::Number(count as f64))
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
    fn counts_mixed_range() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("A3", Value::Boolean(true)),
            ],
            "=COUNTA(A1:A4)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn empty_string_counts() {
        let v = eval_with(&[("A1", "".into()), ("A2", 1.0.into())], "=COUNTA(A1:A3)");
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn blank_cells_not_counted() {
        let v = eval_with(&[], "=COUNTA(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn direct_args() {
        assert_eq!(n(&eval("=COUNTA(1,2,3)")), 3.0);
    }

    #[test]
    fn zero_counts() {
        let v = eval_with(&[("A1", 0.0.into())], "=COUNTA(A1:A3)");
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn text_bool_number() {
        assert_eq!(n(&eval(r#"=COUNTA("x",1,TRUE)"#)), 3.0);
    }

    #[test]
    fn two_d_range() {
        let v = eval_with(&[("A1", 1.0.into()), ("B2", "t".into())], "=COUNTA(A1:B2)");
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn space_text_counts() {
        assert_eq!(n(&eval(r#"=COUNTA(" ")"#)), 1.0);
    }

    #[test]
    fn all_blank_zero() {
        let v = eval_with(&[], "=COUNTA(A1:A2)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn error_cell_counts() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=COUNTA(A1:A2)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn direct_error_propagates() {
        // SPEC-OPEN P1-COUNTA-010: propagate vs count — currently propagate.
        assert_eq!(e(&eval("=COUNTA(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blank_ref_direct_arg_not_counted() {
        // A blank *cell ref* is range-derived: not counted (COUNTA(A1) = 0).
        let v = eval_with(&[], "=COUNTA(A1)");
        assert_eq!(n(&v), 0.0);
    }
}
