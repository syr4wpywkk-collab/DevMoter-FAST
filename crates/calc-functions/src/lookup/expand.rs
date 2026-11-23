//! `EXPAND(array, rows, [columns], [pad_with])` — pad `array` out to
//! `rows` x `columns` (totals, not deltas); new cells fill with
//! `pad_with` (default `#N/A`). Spec: `docs/functions/EXPAND.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 4) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let rows = match dim(ctx, args.get(1), a.rows())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r,
    };
    let cols = match dim(ctx, args.get(2), a.cols())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    if rows < a.rows() || cols < a.cols() {
        return Ok(Value::Error(CalcError::Value));
    }
    let pad = match args.get(3) {
        Some(Expr::Missing) | None => Value::Error(CalcError::NA),
        Some(e) => {
            let v = ctx.eval(e)?;
            match v {
                // A scalar pad; an array pad uses its top-left cell
                // (SPEC-OPEN in EXPAND.md).
                Value::Array(m) => m.get(0, 0).cloned().unwrap_or(Value::Blank),
                other => other,
            }
        }
    };
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for r in 0..rows {
        for c in 0..cols {
            cells.push(a.get(r, c).cloned().unwrap_or_else(|| pad.clone()));
        }
    }
    match ArrayValue::new(rows, cols, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Target dimension: `Expr::Missing`/blank -> `default`; otherwise a
/// truncated non-negative integer (`< 0` or non-numeric -> `#VALUE!`).
fn dim(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: u32,
) -> Result<Result<u32, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(default)),
        Some(e) => ctx.eval(e)?,
    };
    if v.is_blank() {
        return Ok(Ok(default));
    }
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    Ok(v.to_number().and_then(|n| {
        let t = n.trunc();
        if t < 0.0 || t > f64::from(calc_core::MAX_ROWS) {
            Err(CalcError::Value)
        } else {
            Ok(t as u32)
        }
    }))
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
    fn pads_rows_with_na() {
        let (r, c, cells) = arr(&eval("=EXPAND({1,2;3,4},4)"));
        assert_eq!((r, c), (4, 2));
        assert_eq!(cells[4], Value::Error(CalcError::NA));
        assert_eq!(cells[7], Value::Error(CalcError::NA));
    }

    #[test]
    fn pads_columns_with_zero() {
        let (r, c, cells) = arr(&eval("=EXPAND({1,2;3,4},2,3,0)"));
        assert_eq!((r, c), (2, 3));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(2.0),
                Value::Number(0.0),
                Value::Number(3.0),
                Value::Number(4.0),
                Value::Number(0.0)
            ]
        );
    }

    #[test]
    fn text_pad() {
        let (_, _, cells) = arr(&eval(r#"=EXPAND({1,2;3,4},3,3,"x")"#));
        assert_eq!(cells[2], Value::Text("x".into()));
        assert_eq!(cells[8], Value::Text("x".into()));
    }

    #[test]
    fn shrinking_is_an_error() {
        assert_eq!(e(&eval("=EXPAND({1,2;3,4},1)")), CalcError::Value);
        assert_eq!(e(&eval("=EXPAND({1,2;3,4},2,1)")), CalcError::Value);
    }

    #[test]
    fn same_size_is_identity() {
        let (r, c, cells) = arr(&eval("=EXPAND({1,2;3,4},2,2)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[3], Value::Number(4.0));
    }

    #[test]
    fn default_columns_keeps_width() {
        let (_, c, _) = arr(&eval("=EXPAND({1,2,3;4,5,6},3)"));
        assert_eq!(c, 3);
    }

    #[test]
    fn non_numeric_dims() {
        assert_eq!(e(&eval(r#"=EXPAND({1}, "x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=EXPAND({1}, 1, "x")"#)), CalcError::Value);
    }

    #[test]
    fn fractional_dim_truncates() {
        let (r, _, _) = arr(&eval("=EXPAND({1},2.9)"));
        assert_eq!(r, 2);
    }

    #[test]
    fn scalar_source() {
        let (r, c, cells) = arr(&eval("=EXPAND(7,2,2,0)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Number(7.0));
        assert_eq!(cells[1], Value::Number(0.0));
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=EXPAND(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval("=EXPAND({1},1/0)")), CalcError::DivZero);
        // pad_with error value is a legal pad (it is a value).
        let (_, _, cells) = arr(&eval("=EXPAND({1},1,2,#DIV/0!)"));
        assert_eq!(cells[1], Value::Error(CalcError::DivZero));
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=EXPAND({1})")), CalcError::Value);
        assert_eq!(e(&eval("=EXPAND({1},1,1,0,0)")), CalcError::Value);
    }
}
