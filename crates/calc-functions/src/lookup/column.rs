//! `COLUMN([reference])` — column number(s) of a reference.
//! Spec: `docs/functions/COLUMN.md`. Mirror of `ROW` across the other
//! axis; same caller-context gap for the no-argument form (`#N/A` until
//! the evaluator exposes the caller's cell — see `row.rs` / PR notes).

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
        Expr::CellRef { cell, .. } => Value::Number(cell.col as f64 + 1.0),
        Expr::RangeRef { range, .. } => {
            let n = range.normalized();
            let cells: Vec<Value> = (n.start.col..=n.end.col)
                .map(|c| Value::Number(c as f64 + 1.0))
                .collect();
            Value::Array(ArrayValue::from_row(cells).expect("col list"))
        }
        Expr::Missing => Value::Error(CalcError::NA),
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
        assert_eq!(n(&eval("=COLUMN(C3)")), 3.0);
    }

    #[test]
    fn beyond_z() {
        assert_eq!(n(&eval("=COLUMN(AA10)")), 27.0);
    }

    #[test]
    fn absolute_ref() {
        assert_eq!(n(&eval("=COLUMN($D$1)")), 4.0);
    }

    #[test]
    fn range_returns_column_array() {
        let v = eval("=COLUMN(A1:C1)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (1, 3));
        assert_eq!(a.get(0, 0), Some(&Value::Number(1.0)));
        assert_eq!(a.get(0, 2), Some(&Value::Number(3.0)));
    }

    #[test]
    fn tall_range_uses_cols() {
        let v = eval("=COLUMN(B3:D5)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (1, 3));
        assert_eq!(a.get(0, 0), Some(&Value::Number(2.0)));
    }

    #[test]
    fn single_cell_range() {
        let v = eval("=COLUMN(C3:C3)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!(a.get(0, 0), Some(&Value::Number(3.0)));
    }

    #[test]
    fn non_reference_is_value_error() {
        assert_eq!(e(&eval("=COLUMN(3)")), CalcError::Value);
        assert_eq!(e(&eval(r#"=COLUMN("C3")"#)), CalcError::Value);
    }

    #[test]
    fn no_arg_caller_unavailable() {
        assert_eq!(e(&eval("=COLUMN()")), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=COLUMN(A1,B2)")), CalcError::Value);
    }
}
