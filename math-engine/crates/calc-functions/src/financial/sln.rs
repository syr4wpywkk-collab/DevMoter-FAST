//! `SLN(cost, salvage, life)` — straight-line depreciation per
//! period: `(cost - salvage) / life`. Spec: `docs/functions/SLN.md`.
//!
//! `life = 0` is `#DIV/0!`. A negative `life` passes through
//! algebraically (SPEC-OPEN: whether Excel reports `#NUM!` or the
//! negative result for `life < 0`); `salvage > cost` yields negative
//! depreciation as documented.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::arg_num;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let cost = match arg_num(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let salvage = match arg_num(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let life = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if life == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number((cost - salvage) / life))
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
    fn spec_example_1() {
        assert_eq!(n(&eval("=SLN(30000,7500,10)")), 2250.0);
    }

    #[test]
    fn spec_example_zero() {
        assert_eq!(n(&eval("=SLN(1000,1000,5)")), 0.0);
    }

    #[test]
    fn spec_example_2() {
        assert_eq!(n(&eval("=SLN(5000,500,4)")), 1125.0);
    }

    #[test]
    fn life_zero_div_zero() {
        assert_eq!(e(&eval("=SLN(1000,100,0)")), CalcError::DivZero);
    }

    #[test]
    fn appreciation_negative_result() {
        // salvage > cost -> negative depreciation (documented).
        assert_eq!(n(&eval("=SLN(1000,1500,5)")), -100.0);
    }

    #[test]
    fn fractional_life() {
        assert_eq!(n(&eval("=SLN(1000,0,2.5)")), 400.0);
    }

    #[test]
    fn fractional_cost_salvage() {
        let got = n(&eval("=SLN(100.75,10.25,3)"));
        assert!((got - 30.1666667).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn negative_cost_passes_through() {
        assert_eq!(n(&eval("=SLN(-1000,0,4)")), -250.0);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=SLN(1000,"x",5)"#)), CalcError::Value);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=SLN("30000",7500,10)"#)), 2250.0);
    }

    #[test]
    fn boolean_coerces() {
        // TRUE -> 1: (100 - 0) / 1 ... use it for life.
        assert_eq!(n(&eval("=SLN(100,0,TRUE)")), 100.0);
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=SLN(1000,100,A1)");
        assert_eq!(e(&v), CalcError::NA);
    }
}
