//! `SCAN([initial_value], array, LAMBDA(acc, value))` — running
//! accumulation: returns an array of the same shape holding each
//! intermediate accumulator value. Spec: `docs/functions/SCAN.md`.
//!
//! Traversal is row-major; the result preserves the input shape. With
//! `initial_value` the accumulator seeds from it and the lambda runs on
//! every element; without it the first element seeds the accumulator
//! (the lambda is not invoked for it), mirroring `REDUCE`.
//!
//! SPEC-OPEN: once the accumulator is an error, remaining elements
//! carry that error without invoking the lambda further (short-circuit,
//! same policy as `REDUCE`; Excel's exact behavior is unconfirmed).

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let Value::Lambda(lam) = ctx.eval(args.last().unwrap())? else {
        return Ok(Value::Error(CalcError::Value));
    };
    if lam.params.len() != 2 {
        return Ok(Value::Error(CalcError::Value));
    }
    let (init_expr, array_expr) = if args.len() == 3 {
        (Some(&args[0]), &args[1])
    } else {
        (None, &args[0])
    };
    let arr = match coercion::eval_array(ctx, array_expr)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let (rows, cols) = (arr.rows(), arr.cols());
    let cells = arr.cells();
    let mut out = Vec::with_capacity(cells.len());
    let mut acc = match init_expr {
        Some(e) => ctx.eval(e)?,
        None => {
            out.push(cells[0].clone());
            cells[0].clone()
        }
    };
    // SPEC-OPEN: an error accumulator propagates to every remaining
    // element without further lambda calls (REDUCE short-circuits).
    if acc.is_error() {
        while out.len() < cells.len() {
            out.push(acc.clone());
        }
        return finish(rows, cols, out);
    }
    let start = if init_expr.is_some() { 0 } else { 1 };
    for v in &cells[start..] {
        if acc.is_error() {
            out.push(acc.clone());
            continue;
        }
        acc = ctx.call_lambda(&lam, vec![acc, v.clone()])?;
        out.push(acc.clone());
    }
    finish(rows, cols, out)
}

fn finish(rows: u32, cols: u32, cells: Vec<Value>) -> Result<Value, EvalError> {
    match ArrayValue::new(rows, cols, cells) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn cells(v: &Value) -> Vec<Value> {
        match v {
            Value::Array(a) => a.cells().to_vec(),
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
    fn spec_example_running_sum() {
        let v = eval("=SCAN(0,{1,2,3,4},LAMBDA(a,v,a+v))");
        assert_eq!(
            cells(&v),
            vec![
                Value::Number(1.0),
                Value::Number(3.0),
                Value::Number(6.0),
                Value::Number(10.0)
            ]
        );
    }

    #[test]
    fn spec_example_text_accumulation() {
        let v = eval(r#"=SCAN("",{"a","b","c"},LAMBDA(a,v,a&v))"#);
        assert_eq!(
            cells(&v),
            vec![
                Value::Text("a".into()),
                Value::Text("ab".into()),
                Value::Text("abc".into())
            ]
        );
    }

    #[test]
    fn shape_preserved_2d() {
        let v = eval("=SCAN(0,{1,2;3,4},LAMBDA(a,v,a+v))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!((a.rows(), a.cols()), (2, 2));
        assert_eq!(
            a.cells(),
            &[
                Value::Number(1.0),
                Value::Number(3.0),
                Value::Number(6.0),
                Value::Number(10.0)
            ]
        );
    }

    #[test]
    fn no_initial_value_seeds_first() {
        // SPEC-OPEN: first element seeds acc; lambda not invoked for it.
        let v = eval("=SCAN({1,2,3},LAMBDA(a,v,a+v))");
        assert_eq!(
            cells(&v),
            vec![Value::Number(1.0), Value::Number(3.0), Value::Number(6.0)]
        );
    }

    #[test]
    fn single_element_no_init() {
        let v = eval("=SCAN({7},LAMBDA(a,v,a+v))");
        assert_eq!(cells(&v), vec![Value::Number(7.0)]);
    }

    #[test]
    fn over_range() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=SCAN(0,A1:A3,LAMBDA(a,v,a+v))",
        );
        assert_eq!(
            cells(&v),
            vec![Value::Number(1.0), Value::Number(3.0), Value::Number(6.0)]
        );
    }

    #[test]
    fn lambda_arity_must_be_two() {
        assert_eq!(e(&eval("=SCAN(0,{1,2},LAMBDA(a,a))")), CalcError::Value);
    }

    #[test]
    fn non_lambda_rejected() {
        assert_eq!(e(&eval("=SCAN(0,{1,2},42)")), CalcError::Value);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SCAN({1,2})")), CalcError::Value);
        assert_eq!(e(&eval("=SCAN(0,{1},LAMBDA(a,v,v),1)")), CalcError::Value);
    }

    #[test]
    fn initial_error_fills_all() {
        // SPEC-OPEN: error acc propagates to every element.
        let v = eval("=SCAN(1/0,{1,2},LAMBDA(a,v,a+v))");
        assert_eq!(
            cells(&v),
            vec![
                Value::Error(CalcError::DivZero),
                Value::Error(CalcError::DivZero)
            ]
        );
    }

    #[test]
    fn mid_error_propagates_forward() {
        // SPEC-OPEN: element errors persist in the accumulator.
        let v = eval("=SCAN(0,{1,0,2},LAMBDA(a,v,1/v+a))");
        let c = cells(&v);
        assert_eq!(c[0], Value::Number(1.0));
        assert_eq!(c[1], Value::Error(CalcError::DivZero));
        assert_eq!(c[2], Value::Error(CalcError::DivZero));
    }

    #[test]
    fn error_element_in_array() {
        // An error array element feeds the accumulator -> error.
        let v = eval("=SCAN(0,{1,#N/A},LAMBDA(a,v,a+v))");
        let c = cells(&v);
        assert_eq!(c[1], Value::Error(CalcError::NA));
    }

    #[test]
    fn accumulator_may_change_type() {
        let v = eval(r#"=SCAN(0,{"x","y"},LAMBDA(a,v,v))"#);
        assert_eq!(
            cells(&v),
            vec![Value::Text("x".into()), Value::Text("y".into())]
        );
    }

    #[test]
    fn closure_over_let() {
        let v = eval("=LET(k,2,SCAN(0,{1,2},LAMBDA(a,v,a+v*k)))");
        assert_eq!(cells(&v), vec![Value::Number(2.0), Value::Number(6.0)]);
    }
}
