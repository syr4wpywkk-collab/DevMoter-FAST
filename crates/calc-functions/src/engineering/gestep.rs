//! `GESTEP(number, [step])` — `1` when `number >= step`, else `0`;
//! `step` defaults to `0`. Spec: `docs/functions/GESTEP.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let step = if args.len() == 2 {
        match ctx.eval(&args[1])?.to_number() {
            Ok(v) => v,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        0.0
    };
    Ok(Value::Number(if n >= step { 1.0 } else { 0.0 }))
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
    fn spec_examples() {
        assert_eq!(n(&eval("=GESTEP(5,4)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(5,5)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(-4,-5)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(-1)")), 0.0);
        assert_eq!(e(&eval(r#"=GESTEP("x",1)"#)), CalcError::Value);
    }

    #[test]
    fn below_step() {
        assert_eq!(n(&eval("=GESTEP(3,4)")), 0.0);
        assert_eq!(n(&eval("=GESTEP(-5,-4)")), 0.0);
    }

    #[test]
    fn step_defaults_zero() {
        assert_eq!(n(&eval("=GESTEP(0)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(0.001)")), 1.0);
    }

    #[test]
    fn exact_boundary() {
        assert_eq!(n(&eval("=GESTEP(4,4)")), 1.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=GESTEP("5","4")"#)), 1.0);
    }

    #[test]
    fn boolean_coerces() {
        // SPEC-OPEN: boolean coercion (GESTEP.md).
        assert_eq!(n(&eval("=GESTEP(TRUE,1)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(FALSE)")), 1.0);
    }

    #[test]
    fn blank_refs_zero() {
        assert_eq!(n(&eval("=GESTEP(A1)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(2,A1)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(-2,A1)")), 0.0);
    }

    #[test]
    fn bad_step_value_error() {
        assert_eq!(e(&eval(r#"=GESTEP(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval("=GESTEP(0.5,0.25)")), 1.0);
        assert_eq!(n(&eval("=GESTEP(0.25,0.5)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=GESTEP(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=GESTEP(0,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=GESTEP()")), CalcError::Value);
        assert_eq!(e(&eval("=GESTEP(1,2,3)")), CalcError::Value);
    }
}
