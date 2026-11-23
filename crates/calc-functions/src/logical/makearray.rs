//! `MAKEARRAY(rows, columns, LAMBDA)` — returns a `rows x columns`
//! array by calling `LAMBDA(row_index, column_index)` per cell.
//! Spec: `docs/functions/MAKEARRAY.md`.
//!
//! Indices are 1-based; cells fill row-major. Lambda invocations
//! consume the shared step budget via [`EvalContext::call_lambda`].
//!
//! SPEC-OPEN: invalid (non-positive) dimensions return `#VALUE!` here —
//! the spec doc notes Excel's exact kind is unconfirmed (`#CALC!` was
//! the alternative). Errors inside an element call become that
//! element's value; array-returning lambdas produce `#CALC!` elements
//! (higher-dim spill rule, kind unconfirmed).

use crate::common::coercion;
use calc_core::array::{ArrayValue, MAX_ARRAY_CELLS};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let Value::Lambda(lam) = ctx.eval(&args[2])? else {
        return Ok(Value::Error(CalcError::Value));
    };
    if lam.params.len() != 2 {
        return Ok(Value::Error(CalcError::Value));
    }
    let mut dims = [0i64; 2];
    for (i, slot) in dims.iter_mut().enumerate() {
        let n = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(n) if n.is_finite() => n.trunc() as i64,
            Ok(_) => i64::MAX,
        };
        *slot = n;
    }
    let [rows, cols] = dims;
    if rows < 1 || cols < 1 {
        // SPEC-OPEN: kind unconfirmed; spec doc leans `#VALUE!`.
        return Ok(Value::Error(CalcError::Value));
    }
    if rows as u64 * cols as u64 > MAX_ARRAY_CELLS as u64 {
        return Ok(Value::Error(CalcError::Calc));
    }
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for r in 1..=rows {
        for c in 1..=cols {
            let argv = vec![Value::Number(r as f64), Value::Number(c as f64)];
            match ctx.call_lambda(&lam, argv)? {
                Value::Array(_) => cells.push(Value::Error(CalcError::Calc)),
                v => cells.push(v),
            }
        }
    }
    match ArrayValue::new(rows as u32, cols as u32, cells) {
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
    fn spec_example_product() {
        let v = eval("=MAKEARRAY(3,2,LAMBDA(r,c,r*c))");
        assert_eq!(nums(&v), vec![1.0, 2.0, 2.0, 4.0, 3.0, 6.0]);
        let Value::Array(a) = v else { panic!() };
        assert_eq!((a.rows(), a.cols()), (3, 2));
    }

    #[test]
    fn spec_example_sum() {
        let v = eval("=MAKEARRAY(2,3,LAMBDA(r,c,r+c))");
        assert_eq!(nums(&v), vec![2.0, 3.0, 4.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn one_by_one() {
        assert_eq!(nums(&eval("=MAKEARRAY(1,1,LAMBDA(r,c,r+c))")), vec![2.0]);
    }

    #[test]
    fn truncated_dimensions() {
        // 2.9 truncates to 2 (per SEQUENCE convention).
        let v = eval("=MAKEARRAY(2.9,1.1,LAMBDA(r,c,r))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!((a.rows(), a.cols()), (2, 1));
    }

    #[test]
    fn nonpositive_dims_value_error() {
        // SPEC-OPEN: kind unconfirmed (#VALUE! vs #CALC!).
        assert_eq!(e(&eval("=MAKEARRAY(0,2,LAMBDA(r,c,r))")), CalcError::Value);
        assert_eq!(e(&eval("=MAKEARRAY(2,-1,LAMBDA(r,c,r))")), CalcError::Value);
    }

    #[test]
    fn dim_coercion_error() {
        assert_eq!(
            e(&eval(r#"=MAKEARRAY("x",2,LAMBDA(r,c,r))"#)),
            CalcError::Value
        );
    }

    #[test]
    fn dim_error_propagates() {
        assert_eq!(
            e(&eval("=MAKEARRAY(1/0,2,LAMBDA(r,c,r))")),
            CalcError::DivZero
        );
    }

    #[test]
    fn lambda_arity_must_be_two() {
        assert_eq!(e(&eval("=MAKEARRAY(2,2,LAMBDA(r,r))")), CalcError::Value);
    }

    #[test]
    fn non_lambda_rejected() {
        assert_eq!(e(&eval("=MAKEARRAY(2,2,5)")), CalcError::Value);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MAKEARRAY(2,2)")), CalcError::Value);
        assert_eq!(
            e(&eval("=MAKEARRAY(1,2,LAMBDA(r,c,r),1)")),
            CalcError::Value
        );
    }

    #[test]
    fn element_errors_are_elementwise() {
        // SPEC-OPEN: error in one cell becomes that element's value.
        let v = eval("=MAKEARRAY(1,2,LAMBDA(r,c,1/(c-1)))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Error(CalcError::DivZero));
        assert_eq!(a.cells()[1], Value::Number(1.0));
    }

    #[test]
    fn array_result_calc_error() {
        // SPEC-OPEN: nested array results reported as #CALC! elements.
        let v = eval("=MAKEARRAY(1,1,LAMBDA(r,c,{1,2}))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Error(CalcError::Calc));
    }

    #[test]
    fn text_results() {
        let v = eval(r#"=MAKEARRAY(1,2,LAMBDA(r,c,"x"&c))"#);
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Text("x1".into()));
        assert_eq!(a.cells()[1], Value::Text("x2".into()));
    }

    #[test]
    fn closure_over_let() {
        let v = eval("=LET(k,10,MAKEARRAY(2,1,LAMBDA(r,c,r+k)))");
        assert_eq!(nums(&v), vec![11.0, 12.0]);
    }
}
