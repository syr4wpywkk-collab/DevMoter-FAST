//! `DELTA(number1, [number2])` — Kronecker delta: `1` when the two
//! numbers are equal, else `0`. `number2` defaults to `0`.
//! Spec: `docs/functions/DELTA.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let a = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let b = if args.len() == 2 {
        match ctx.eval(&args[1])?.to_number() {
            Ok(v) => v,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        0.0
    };
    // Exact IEEE equality (SPEC-OPEN: no tolerance documented).
    Ok(Value::Number(if a == b { 1.0 } else { 0.0 }))
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
        assert_eq!(n(&eval("=DELTA(5,4)")), 0.0);
        assert_eq!(n(&eval("=DELTA(5,5)")), 1.0);
        assert_eq!(n(&eval("=DELTA(0.5,0)")), 0.0);
        assert_eq!(n(&eval("=DELTA(0)")), 1.0);
        assert_eq!(e(&eval(r#"=DELTA("x",0)"#)), CalcError::Value);
    }

    #[test]
    fn default_arg_zero() {
        assert_eq!(n(&eval("=DELTA(3)")), 0.0);
    }

    #[test]
    fn negative_equal() {
        assert_eq!(n(&eval("=DELTA(-2,-2)")), 1.0);
        assert_eq!(n(&eval("=DELTA(-2,2)")), 0.0);
    }

    #[test]
    fn exact_equality() {
        // 0.1+0.2 != 0.3 in IEEE 754 — exact compare assumed.
        assert_eq!(n(&eval("=DELTA(0.1+0.2,0.3)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        // SPEC-OPEN: text "5" coerces to 5, then compares equal.
        assert_eq!(n(&eval(r#"=DELTA("5",5)"#)), 1.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=DELTA(TRUE,1)")), 1.0);
        assert_eq!(n(&eval("=DELTA(FALSE)")), 1.0);
    }

    #[test]
    fn blank_refs_are_zero() {
        assert_eq!(n(&eval("=DELTA(A1)")), 1.0);
        assert_eq!(n(&eval("=DELTA(A1,B1)")), 1.0);
        assert_eq!(n(&eval("=DELTA(1,A1)")), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=DELTA("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=DELTA(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DELTA(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=DELTA(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DELTA()")), CalcError::Value);
        assert_eq!(e(&eval("=DELTA(1,2,3)")), CalcError::Value);
    }
}
