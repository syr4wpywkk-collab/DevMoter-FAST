//! `MAP(array1, [array2], ..., LAMBDA)` — elementwise lambda application.
//! Spec: `docs/functions/MAP.md`.
//!
//! The final argument must evaluate to a lambda taking exactly one
//! parameter per array. All arrays must have identical shape; elements
//! pass to the lambda in row-major order and the result preserves the
//! input shape. Each invocation consumes step budget through
//! [`EvalContext::call_lambda`], so the per-recalc budget covers all
//! element calls combined.

use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let Value::Lambda(lam) = ctx.eval(args.last().unwrap())? else {
        return Ok(Value::Error(CalcError::Value));
    };
    let n_arrays = args.len() - 1;
    if lam.params.len() != n_arrays {
        return Ok(Value::Error(CalcError::Value));
    }

    // Evaluate each array argument; only `Value::Array` inputs are valid
    // (a scalar or single-cell ref is not a MAP input — #VALUE!).
    let mut arrays = Vec::with_capacity(n_arrays);
    for a in &args[..n_arrays] {
        match ctx.eval_arg(a)?.into_value() {
            Value::Array(arr) => arrays.push(arr),
            Value::Error(e) => return Ok(Value::Error(e)),
            _ => return Ok(Value::Error(CalcError::Value)),
        }
    }
    let (rows, cols) = (arrays[0].rows(), arrays[0].cols());
    if arrays.iter().any(|a| a.rows() != rows || a.cols() != cols) {
        // SPEC-OPEN: shape mismatch -> #VALUE! per spec doc (Excel also
        // errors; whether it is #VALUE! or #N/A is unconfirmed).
        return Ok(Value::Error(CalcError::Value));
    }

    let count = rows as usize * cols as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let argv = arrays.iter().map(|a| a.cells()[i].clone()).collect();
        // Errors inside an element call become that element's value
        // (SPEC-OPEN: Excel may fail the whole call instead).
        out.push(ctx.call_lambda(&lam, argv)?);
    }
    match ArrayValue::new(rows, cols, out) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn nums(v: &Value) -> Vec<f64> {
        match v {
            Value::Array(a) => a
                .cells()
                .iter()
                .map(|c| match c {
                    Value::Number(n) => *n,
                    o => panic!("expected number, got {o:?}"),
                })
                .collect(),
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
    fn single_array_doubles() {
        let v = eval("=MAP({1,2;3,4},LAMBDA(x,x*2))");
        assert_eq!(nums(&v), vec![2.0, 4.0, 6.0, 8.0]);
        let Value::Array(a) = v else { panic!() };
        assert_eq!((a.rows(), a.cols()), (2, 2));
    }

    #[test]
    fn two_arrays_elementwise() {
        let v = eval("=MAP({1,2},{10,20},LAMBDA(a,b,a+b))");
        assert_eq!(nums(&v), vec![11.0, 22.0]);
    }

    #[test]
    fn over_range_input() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=MAP(A1:A3,LAMBDA(x,x^2))",
        );
        assert_eq!(nums(&v), vec![1.0, 4.0, 9.0]);
    }

    #[test]
    fn shape_mismatch_value_error() {
        assert_eq!(
            e(&eval("=MAP({1,2},{1,2,3},LAMBDA(a,b,a+b))")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval("=MAP({1;2},{1,2},LAMBDA(a,b,a+b))")),
            CalcError::Value
        );
    }

    #[test]
    fn lambda_arity_must_match_arrays() {
        assert_eq!(e(&eval("=MAP({1,2},{3,4},LAMBDA(x,x))")), CalcError::Value);
    }

    #[test]
    fn non_lambda_last_arg() {
        assert_eq!(e(&eval("=MAP({1,2},5)")), CalcError::Value);
        assert_eq!(e(&eval("=MAP({1,2})")), CalcError::Value);
    }

    #[test]
    fn scalar_first_arg_rejected() {
        assert_eq!(e(&eval("=MAP(5,LAMBDA(x,x))")), CalcError::Value);
    }

    #[test]
    fn element_errors_are_elementwise() {
        // SPEC-OPEN: error in one element becomes that element's value.
        let v = eval("=MAP({1,0,2},LAMBDA(x,1/x))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[1], Value::Error(CalcError::DivZero));
    }

    #[test]
    fn closure_over_let() {
        let v = eval("=LET(k,10,MAP({1,2,3},LAMBDA(x,x+k)))");
        assert_eq!(nums(&v), vec![11.0, 12.0, 13.0]);
    }

    #[test]
    fn text_results() {
        let v = eval(r#"=MAP({"a","b"},LAMBDA(x,x&"!"))"#);
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Text("a!".into()));
        assert_eq!(a.cells()[1], Value::Text("b!".into()));
    }

    #[test]
    fn nested_map() {
        let v = eval("=MAP({1,2},LAMBDA(x,MAP({10},LAMBDA(y,x+y))))");
        let Value::Array(a) = v else { panic!() };
        // Each element of the outer map is itself a 1x1 array.
        for c in a.cells() {
            let Value::Array(inner) = c else { panic!() };
            assert!(matches!(inner.cells()[0], Value::Number(_)));
        }
    }
}
