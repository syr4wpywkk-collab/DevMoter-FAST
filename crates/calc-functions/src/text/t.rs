//! `T(value)` — returns `value` when it is text, otherwise `""`.
//! Spec: `docs/functions/T.md`.
//!
//! Errors propagate (`T(1/0)` is `#DIV/0!`, not `""`). Blank, numbers
//! and booleans all yield `""`. Array input maps element-wise and spills
//! (dynamic-array broadcast per the spec doc's open question — the
//! engine's uniform behavior for scalar functions on arrays).

use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn t_of(v: &Value) -> Value {
    match v {
        Value::Text(s) => Value::Text(s.clone()),
        Value::Error(e) => Value::Error(*e),
        _ => Value::Text(String::new()),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    Ok(match ctx.eval_arg(&args[0])?.into_value() {
        Value::Array(a) => {
            let cells: Vec<Value> = a.cells().iter().map(t_of).collect();
            match ArrayValue::new(a.rows(), a.cols(), cells) {
                Ok(arr) => Value::Array(arr),
                Err(e) => Value::Error(e),
            }
        }
        v => t_of(&v),
    })
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn returns_text() {
        assert_eq!(t(&eval(r#"=T("abc")"#)), "abc");
        assert_eq!(t(&eval(r#"=T("")"#)), "");
    }

    #[test]
    fn number_is_empty() {
        assert_eq!(t(&eval("=T(123)")), "");
        assert_eq!(t(&eval("=T(-2.5)")), "");
    }

    #[test]
    fn boolean_is_empty() {
        assert_eq!(t(&eval("=T(TRUE)")), "");
        assert_eq!(t(&eval("=T(FALSE)")), "");
    }

    #[test]
    fn blank_is_empty() {
        let v = eval_with(&[("A1", Value::Blank)], "=T(A1)");
        assert_eq!(t(&v), "");
    }

    #[test]
    fn text_cell_passthrough() {
        let v = eval_with(&[("A1", Value::Text("hi".into()))], "=T(A1)");
        assert_eq!(t(&v), "hi");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=T(#N/A)")), CalcError::NA);
    }

    #[test]
    fn text_formulas_stay_text() {
        assert_eq!(t(&eval(r#"=T("a"&"b")"#)), "ab");
    }

    #[test]
    fn array_maps_elementwise() {
        let v = eval_with(
            &[
                ("A1", Value::Text("x".into())),
                ("A2", Value::Number(5.0)),
                ("A3", Value::Text("y".into())),
            ],
            "=T(A1:A3)",
        );
        match v {
            Value::Array(a) => {
                assert_eq!(a.rows(), 3);
                assert_eq!(a.get(0, 0), Some(&Value::Text("x".into())));
                assert_eq!(a.get(1, 0), Some(&Value::Text("".into())));
                assert_eq!(a.get(2, 0), Some(&Value::Text("y".into())));
            }
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn numeric_literal_ignores_look() {
        assert_eq!(t(&eval(r#"=T("123")"#)), "123");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=T()")), CalcError::Value);
        assert_eq!(e(&eval("=T(1,2)")), CalcError::Value);
    }
}
