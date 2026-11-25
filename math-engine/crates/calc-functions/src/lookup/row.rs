//! `ROW([reference])` — row number(s) of a reference.
//! Spec: `docs/functions/ROW.md`.
//!
//! Implemented from the argument's AST shape: a `CellRef` yields its
//! 1-based row; a `RangeRef` yields the column array of covered rows
//! (dynamic-array semantics — legacy implicit intersection is
//! SPEC-OPEN). The reference is inspected, not evaluated, so error
//! cells inside a range do not matter.
//!
//! **Gap:** `ROW()` with no argument needs the caller's cell position,
//! which `EvalContext` does not expose yet — returns `#N/A` until the
//! evaluator plumbs caller context (see PR notes).

use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(_ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 1) {
        return Ok(Value::Error(e));
    }
    let Some(arg) = args.first() else {
        // Caller-cell position is not available through EvalContext.
        return Ok(Value::Error(CalcError::NA));
    };
    Ok(match arg {
        Expr::CellRef { cell, .. } => Value::Number(cell.row as f64 + 1.0),
        Expr::RangeRef { range, .. } => {
            let n = range.normalized();
            let cells: Vec<Value> = (n.start.row..=n.end.row)
                .map(|r| Value::Number(r as f64 + 1.0))
                .collect();
            Value::Array(ArrayValue::from_column(cells).expect("row list"))
        }
        Expr::Missing => Value::Error(CalcError::NA),
        // Excel requires a reference argument; anything else is #VALUE!.
        _ => Value::Error(CalcError::Value),
    })
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
    fn single_cell() {
        assert_eq!(n(&eval("=ROW(A5)")), 5.0);
    }

    #[test]
    fn large_row() {
        assert_eq!(n(&eval("=ROW(X1000)")), 1000.0);
    }

    #[test]
    fn absolute_ref() {
        assert_eq!(n(&eval("=ROW($A$7)")), 7.0);
    }

    #[test]
    fn range_returns_row_array() {
        let v = eval("=ROW(A5:A7)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (3, 1));
        assert_eq!(a.get(0, 0), Some(&Value::Number(5.0)));
        assert_eq!(a.get(2, 0), Some(&Value::Number(7.0)));
    }

    #[test]
    fn reversed_range_normalized() {
        let v = eval("=ROW(A7:A5)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!(a.get(0, 0), Some(&Value::Number(5.0)));
    }

    #[test]
    fn wide_range_uses_rows() {
        let v = eval("=ROW(B3:D5)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (3, 1));
    }

    #[test]
    fn single_cell_range() {
        let v = eval("=ROW(A5:A5)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!(a.get(0, 0), Some(&Value::Number(5.0)));
    }

    #[test]
    fn non_reference_is_value_error() {
        assert_eq!(e(&eval("=ROW(3)")), CalcError::Value);
        assert_eq!(e(&eval(r#"=ROW("A5")"#)), CalcError::Value);
        assert_eq!(e(&eval("=ROW(1+2)")), CalcError::Value);
    }

    #[test]
    fn no_arg_caller_unavailable() {
        // Engine gap: caller position is not in EvalContext yet.
        assert_eq!(e(&eval("=ROW()")), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=ROW(A1,B2)")), CalcError::Value);
    }
}
