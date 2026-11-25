//! `BYROW(array, LAMBDA)` — applies a LAMBDA to each row of `array`
//! and returns a single-column array of the per-row results.
//! Spec: `docs/functions/BYROW.md`.
//!
//! Each row passes to the lambda as a `1 x cols` `Value::Array`.
//! Result shape is `rows(array) x 1`. Lambda invocations consume the
//! shared step budget via [`EvalContext::call_lambda`].
//!
//! SPEC-OPEN: a lambda returning more than one value per row becomes
//! that element's `#CALC!` error (kind unconfirmed); errors inside a
//! row's call are element-wise (Excel may fail the whole call — same
//! question as `MAP`/`BYCOL`).

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let Value::Lambda(lam) = ctx.eval(&args[1])? else {
        return Ok(Value::Error(CalcError::Value));
    };
    if lam.params.len() != 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let arr = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let (rows, cols) = (arr.rows(), arr.cols());
    let mut out = Vec::with_capacity(rows as usize);
    for i in 0..rows {
        let row = (0..cols)
            .map(|j| arr.get(i, j).unwrap().clone())
            .collect::<Vec<_>>();
        let row_arr = match ArrayValue::from_row(row) {
            Ok(a) => a,
            Err(e) => return Ok(Value::Error(e)),
        };
        match ctx.call_lambda(&lam, vec![Value::Array(row_arr)])? {
            Value::Array(_) => out.push(Value::Error(CalcError::Calc)),
            v => out.push(v),
        }
    }
    match ArrayValue::from_column(out) {
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
    fn spec_example_row_sums() {
        let v = eval("=BYROW({1,2,3;4,5,6},LAMBDA(r,SUM(r)))");
        assert_eq!(nums(&v), vec![6.0, 15.0]);
        let Value::Array(a) = v else { panic!() };
        assert_eq!((a.rows(), a.cols()), (2, 1));
    }

    #[test]
    fn single_row() {
        assert_eq!(nums(&eval("=BYROW({2,4},LAMBDA(r,MAX(r)))")), vec![4.0]);
    }

    #[test]
    fn over_range() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 2.0.into()),
                ("A2", 3.0.into()),
                ("B2", 4.0.into()),
            ],
            "=BYROW(A1:B2,LAMBDA(r,SUM(r)))",
        );
        assert_eq!(nums(&v), vec![3.0, 7.0]);
    }

    #[test]
    fn lambda_sees_row_vector() {
        // COLUMNS(r) reports the row width.
        let v = eval("=BYROW({1,2,3;4,5,6},LAMBDA(r,COLUMNS(r)))");
        assert_eq!(nums(&v), vec![3.0, 3.0]);
    }

    #[test]
    fn lambda_arity_must_be_one() {
        assert_eq!(e(&eval("=BYROW({1;2},LAMBDA(a,b,a))")), CalcError::Value);
    }

    #[test]
    fn non_lambda_rejected() {
        assert_eq!(e(&eval("=BYROW({1;2},5)")), CalcError::Value);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BYROW({1;2})")), CalcError::Value);
        assert_eq!(e(&eval("=BYROW({1;2},LAMBDA(r,r),1)")), CalcError::Value);
    }

    #[test]
    fn array_arg_error_propagates() {
        assert_eq!(e(&eval("=BYROW(1/0,LAMBDA(r,r))")), CalcError::DivZero);
    }

    #[test]
    fn element_errors_are_elementwise() {
        // SPEC-OPEN: error in one row becomes that element's value.
        let v = eval("=BYROW({1;0},LAMBDA(r,1/SUM(r)))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Number(1.0));
        assert_eq!(a.cells()[1], Value::Error(CalcError::DivZero));
    }

    #[test]
    fn multi_value_lambda_calc_error() {
        // SPEC-OPEN: kind unconfirmed; engine reports #CALC! per spec.
        let v = eval("=BYROW({1;2},LAMBDA(r,{1;2}))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Error(CalcError::Calc));
        assert_eq!(a.cells()[1], Value::Error(CalcError::Calc));
    }

    #[test]
    fn text_results() {
        let v = eval(r#"=BYROW({"a";"b"},LAMBDA(r,INDEX(r,1)&"!"))"#);
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Text("a!".into()));
        assert_eq!(a.cells()[1], Value::Text("b!".into()));
    }

    #[test]
    fn closure_over_let() {
        let v = eval("=LET(k,10,BYROW({1;2},LAMBDA(r,SUM(r)+k)))");
        assert_eq!(nums(&v), vec![11.0, 12.0]);
    }
}
