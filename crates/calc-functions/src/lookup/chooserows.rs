//! `CHOOSEROWS(array, row_num1, [row_num2], ...)` — the selected rows
//! of `array`, in the order given. Negative indexes count from the
//! bottom. Spec: `docs/functions/CHOOSEROWS.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, usize::MAX) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let rows = match indexes(ctx, &args[1..], a.rows())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r,
    };
    let mut cells = Vec::with_capacity(rows.len() * a.cols() as usize);
    for &r in &rows {
        for c in 0..a.cols() {
            cells.push(a.get(r, c).expect("index validated").clone());
        }
    }
    match ArrayValue::new(rows.len() as u32, a.cols(), cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Evaluate each index arg to a 0-based row index (truncated;
/// negatives count from the bottom). `0`/out-of-range -> `#VALUE!`.
fn indexes(
    ctx: &mut EvalContext<'_>,
    exprs: &[Expr],
    height: u32,
) -> Result<Result<Vec<u32>, CalcError>, EvalError> {
    let mut out = Vec::with_capacity(exprs.len());
    for e in exprs {
        let v = ctx.eval(e)?;
        if let Some(err) = v.error() {
            return Ok(Err(err));
        }
        let n = match v.to_number() {
            Ok(n) => n.trunc() as i64,
            Err(err) => return Ok(Err(err)),
        };
        let h = i64::from(height);
        if n == 0 || n > h || n < -h {
            return Ok(Err(CalcError::Value));
        }
        out.push(if n > 0 { n - 1 } else { h + n } as u32);
    }
    Ok(Ok(out))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> (u32, u32, Vec<Value>) {
        match v {
            Value::Array(a) => (a.rows(), a.cols(), a.cells().to_vec()),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn picks_two_rows() {
        let (r, c, cells) = arr(&eval("=CHOOSEROWS({1,2;3,4;5,6},1,3)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(2.0),
                Value::Number(5.0),
                Value::Number(6.0)
            ]
        );
    }

    #[test]
    fn negative_index_counts_from_bottom() {
        let (_, _, cells) = arr(&eval("=CHOOSEROWS({1,2;3,4;5,6},-1)"));
        assert_eq!(cells, vec![Value::Number(5.0), Value::Number(6.0)]);
    }

    #[test]
    fn repeats_and_reorders() {
        let (r, _, cells) = arr(&eval("=CHOOSEROWS({1,2;3,4;5,6},3,1)"));
        assert_eq!(r, 2);
        assert_eq!(cells[0], Value::Number(5.0));
        assert_eq!(cells[2], Value::Number(1.0));
    }

    #[test]
    fn out_of_range_index() {
        assert_eq!(e(&eval("=CHOOSEROWS({1;2;3},4)")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSEROWS({1;2;3},-4)")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSEROWS({1;2;3},0)")), CalcError::Value);
    }

    #[test]
    fn scalar_first_arg_is_1x1() {
        let (_, _, cells) = arr(&eval("=CHOOSEROWS(9,1)"));
        assert_eq!(cells, vec![Value::Number(9.0)]);
        assert_eq!(e(&eval("=CHOOSEROWS(9,2)")), CalcError::Value);
    }

    #[test]
    fn range_argument() {
        let v = eval_with(
            &[("A1", Value::Number(1.0)), ("A2", Value::Number(2.0))],
            "=CHOOSEROWS(A1:A2,-1)",
        );
        let (_, _, cells) = arr(&v);
        assert_eq!(cells, vec![Value::Number(2.0)]);
    }

    #[test]
    fn error_in_selected_row_propagates() {
        let (_, _, cells) = arr(&eval("=CHOOSEROWS({1;2;#N/A},3)"));
        assert_eq!(cells, vec![Value::Error(CalcError::NA)]);
    }

    #[test]
    fn error_in_unselected_row_dropped() {
        let (_, _, cells) = arr(&eval("=CHOOSEROWS({#N/A;2;#DIV/0!},2)"));
        assert_eq!(cells, vec![Value::Number(2.0)]);
    }

    #[test]
    fn fractional_index_truncates() {
        let (_, _, cells) = arr(&eval("=CHOOSEROWS({1;2;3},2.9)"));
        assert_eq!(cells, vec![Value::Number(2.0)]);
    }

    #[test]
    fn arg_errors_propagate() {
        assert_eq!(e(&eval("=CHOOSEROWS(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=CHOOSEROWS({1},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=CHOOSEROWS({1})")), CalcError::Value);
    }

    #[test]
    fn keeps_all_columns() {
        let (_, c, _) = arr(&eval("=CHOOSEROWS({1,2,3;4,5,6},2)"));
        assert_eq!(c, 3);
    }
}
