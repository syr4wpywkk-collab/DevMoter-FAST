//! `TYPE(value)` — returns a code for the data type of `value`:
//! number 1, text 2, logical 4, error 16, array 64, anything else
//! (lambda) 128. Errors are inspected, not propagated. Spec:
//! `docs/functions/TYPE.md`.
//!
//! `type` is a Rust keyword, so the file is `type_fn.rs` (same
//! convention as `logical/if_fn.rs`, ADR 0001).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval_arg(&args[0])?.into_value();
    let code = match v {
        // SPEC-OPEN: Excel types a blank cell as 1 (numeric).
        Value::Blank | Value::Number(_) => 1.0,
        Value::Text(_) => 2.0,
        Value::Boolean(_) => 4.0,
        Value::Error(_) => 16.0,
        Value::Array(_) => 64.0,
        // "Anything else" per modern Excel docs; a Reference value is
        // dereferenced before reaching functions, so it is effectively
        // unreachable here.
        Value::Lambda(_) | Value::Reference(_) => 128.0,
    };
    Ok(Value::Number(code))
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
        assert_eq!(n(&eval("=TYPE(1.5)")), 1.0);
        assert_eq!(n(&eval(r#"=TYPE("abc")"#)), 2.0);
        assert_eq!(n(&eval("=TYPE(TRUE)")), 4.0);
        assert_eq!(n(&eval("=TYPE(1/0)")), 16.0);
        assert_eq!(n(&eval("=TYPE({1,2;3,4})")), 64.0);
    }

    #[test]
    fn blank_cell_is_one() {
        assert_eq!(n(&eval("=TYPE(A1)")), 1.0);
    }

    #[test]
    fn number_cell_one() {
        assert_eq!(n(&eval_with(&[("A1", 9.0.into())], "=TYPE(A1)")), 1.0);
    }

    #[test]
    fn text_cell_two() {
        assert_eq!(n(&eval_with(&[("A1", "x".into())], "=TYPE(A1)")), 2.0);
    }

    #[test]
    fn boolean_cell_four() {
        assert_eq!(
            n(&eval_with(&[("A1", Value::Boolean(false))], "=TYPE(A1)")),
            4.0
        );
    }

    #[test]
    fn error_cell_sixteen() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=TYPE(A1)");
        assert_eq!(n(&v), 16.0);
    }

    #[test]
    fn na_is_sixteen_not_propagated() {
        assert_eq!(n(&eval("=TYPE(NA())")), 16.0);
        assert_eq!(n(&eval("=TYPE(#REF!)")), 16.0);
        assert_eq!(n(&eval("=TYPE(#NULL!)")), 16.0);
    }

    #[test]
    fn date_is_one() {
        assert_eq!(n(&eval("=TYPE(DATE(2020,1,1))")), 1.0);
    }

    #[test]
    fn range_is_sixtyfour() {
        assert_eq!(n(&eval("=TYPE(A1:B2)")), 64.0);
    }

    #[test]
    fn lambda_is_128() {
        // SPEC-OPEN: exact code for lambda values (128 = "other").
        assert_eq!(n(&eval("=TYPE(LAMBDA(x,x))")), 128.0);
    }

    #[test]
    fn guards_error_branch() {
        let v = eval(r#"=IF(TYPE(1/0)=16,"err","ok")"#);
        assert_eq!(v, Value::Text("err".into()));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=TYPE()")), CalcError::Value);
        assert_eq!(e(&eval("=TYPE(1,2)")), CalcError::Value);
    }
}
