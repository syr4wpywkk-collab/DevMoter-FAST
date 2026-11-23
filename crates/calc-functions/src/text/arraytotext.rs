//! `ARRAYTOTEXT(array, [format])` — converts an array or range into a
//! single text value listing its elements.
//! Spec: `docs/functions/ARRAYTOTEXT.md`.
//!
//! `format` `0` (default) joins elements with `", "` row-major, text
//! unquoted; `1` produces Excel array-constant syntax
//! (`{"a","b";1,2}`) with text double-quoted (inner quotes doubled),
//! booleans as `TRUE`/`FALSE` and errors as their code text. A scalar
//! `array` argument returns the plain element form (no braces).
//! Error cells render as their code text rather than propagating
//! (SPEC-OPEN in the spec doc; fixtures are marked `specOpen`).

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::{Value, format_number};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let format = match coercion::eval_opt_number(ctx, args.get(1), 0.0)? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !format.is_finite() {
        return Ok(Value::Error(CalcError::Value));
    }
    let strict = match format.trunc() as i64 {
        0 => false,
        1 => true,
        _ => return Ok(Value::Error(CalcError::Value)),
    };
    match ctx.eval_arg(&args[0])? {
        ArgValue::Range(a) | ArgValue::Scalar(Value::Array(a)) | ArgValue::Ref(Value::Array(a)) => {
            Ok(Value::Text(render_array(&a, strict)))
        }
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => Ok(Value::Error(e)),
        ArgValue::Scalar(v) | ArgValue::Ref(v) => Ok(Value::Text(element(&v, false))),
    }
}

/// Render one element: `strict` double-quotes text (inner quotes
/// doubled); the concise form emits text unquoted. Errors render as
/// their code text; blanks as empty.
fn element(v: &Value, strict: bool) -> String {
    match v {
        Value::Text(s) => {
            if strict {
                format!("\"{}\"", s.replace('"', "\"\""))
            } else {
                s.clone()
            }
        }
        Value::Number(n) => format_number(*n),
        Value::Boolean(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Value::Error(e) => e.code().to_string(),
        Value::Blank => String::new(),
        // Nested arrays/lambdas/references cannot appear inside an
        // evaluated ArrayValue; render their coercion failure.
        _ => CalcError::Value.code().to_string(),
    }
}

fn render_array(a: &ArrayValue, strict: bool) -> String {
    if !strict {
        // Concise: every element joined by ", " in row-major order.
        let mut cells = Vec::new();
        for r in 0..a.rows() {
            for c in 0..a.cols() {
                cells.push(element(a.get(r, c).unwrap_or(&Value::Blank), false));
            }
        }
        return cells.join(", ");
    }
    let mut rows = Vec::new();
    for r in 0..a.rows() {
        let mut cells = Vec::new();
        for c in 0..a.cols() {
            cells.push(element(a.get(r, c).unwrap_or(&Value::Blank), true));
        }
        rows.push(cells.join(","));
    }
    format!("{{{}}}", rows.join(";"))
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
    fn concise_row_array() {
        assert_eq!(t(&eval("=ARRAYTOTEXT({1,2,3})")), "1, 2, 3");
    }

    #[test]
    fn concise_scalar_text() {
        assert_eq!(t(&eval(r#"=ARRAYTOTEXT("hi")"#)), "hi");
    }

    #[test]
    fn strict_array_constant() {
        assert_eq!(
            t(&eval(r#"=ARRAYTOTEXT({"a","b";1,2},1)"#)),
            r#"{"a","b";1,2}"#
        );
    }

    #[test]
    fn strict_booleans_and_text() {
        assert_eq!(t(&eval(r#"=ARRAYTOTEXT({TRUE,"x"},1)"#)), r#"{TRUE,"x"}"#);
    }

    #[test]
    fn strict_scalar_no_braces() {
        assert_eq!(t(&eval(r#"=ARRAYTOTEXT("hi",1)"#)), "hi");
    }

    #[test]
    fn concise_range() {
        let v = eval_with(
            &[("A1", "a".into()), ("B1", 2.5.into()), ("A2", true.into())],
            "=ARRAYTOTEXT(A1:B2)",
        );
        assert_eq!(t(&v), "a, 2.5, TRUE, ");
    }

    #[test]
    fn strict_range_rows_and_cols() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", "x".into()), ("A2", 3.0.into())],
            "=ARRAYTOTEXT(A1:B2,1)",
        );
        assert_eq!(t(&v), r#"{1,"x";3,}"#);
    }

    #[test]
    fn strict_quotes_doubled() {
        assert_eq!(t(&eval(r#"=ARRAYTOTEXT({"a""b"},1)"#)), r#"{"a""b"}"#);
    }

    #[test]
    fn format_invalid_is_value_error() {
        assert_eq!(e(&eval("=ARRAYTOTEXT({1,2},2)")), CalcError::Value);
        assert_eq!(e(&eval("=ARRAYTOTEXT({1,2},-1)")), CalcError::Value);
    }

    #[test]
    fn format_text_is_value_error() {
        assert_eq!(e(&eval(r#"=ARRAYTOTEXT({1,2},"x")"#)), CalcError::Value);
    }

    #[test]
    fn format_truncates() {
        assert_eq!(t(&eval("=ARRAYTOTEXT({1,2},0.9)")), "1, 2");
    }

    #[test]
    fn error_element_renders_code() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=ARRAYTOTEXT(A1:A2)",
        );
        assert_eq!(t(&v), "#N/A, 1");
    }

    #[test]
    fn scalar_error_propagates() {
        assert_eq!(e(&eval("=ARRAYTOTEXT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn concise_numbers_general_format() {
        assert_eq!(t(&eval("=ARRAYTOTEXT({0.5,100})")), "0.5, 100");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ARRAYTOTEXT()")), CalcError::Value);
        assert_eq!(e(&eval("=ARRAYTOTEXT(1,0,3)")), CalcError::Value);
    }
}
