//! `VALUETOTEXT(value, [format])` — scalar-to-text conversion in
//! "concise" (`0`, default) or "strict" (`1`) format.
//! Spec: `docs/functions/VALUETOTEXT.md`.
//!
//! Concise: text passes through unquoted, numbers use the shared
//! General-format rule ([`format_number`]), booleans `TRUE`/`FALSE`,
//! blank `""`. Strict quotes text values (inner quotes doubled) and is
//! otherwise identical. Scalar input never gains `{}` braces — that is
//! `ARRAYTOTEXT`-only.
//!
//! SPEC-OPEN (spec doc): error values render as their code text
//! (`"#N/A"`) rather than propagating — Excel's exact behavior is
//! unconfirmed; fixtures for it are `specOpen`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::{Value, format_number};

/// Render one scalar per `VALUETOTEXT`.
fn render(v: &Value, strict: bool) -> Value {
    match v {
        Value::Text(s) if strict => Value::Text(format!("\"{}\"", s.replace('"', "\"\""))),
        Value::Text(s) => Value::Text(s.clone()),
        Value::Number(n) => Value::Text(format_number(*n)),
        Value::Boolean(b) => Value::Text(if *b { "TRUE" } else { "FALSE" }.to_string()),
        Value::Blank => Value::Text(String::new()),
        Value::Error(e) => Value::Text(e.code().to_string()),
        // Reached only via nested arrays (impossible) — defensive.
        _ => Value::Error(CalcError::Value),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let strict = if args.len() == 2 {
        match coercion::eval_opt_number(ctx, Some(&args[1]), 0.0)? {
            Ok(n) if n.is_finite() => match n.trunc() as i64 {
                0 => false,
                1 => true,
                _ => return Ok(Value::Error(CalcError::Value)),
            },
            Ok(_) => return Ok(Value::Error(CalcError::Value)),
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        false
    };
    Ok(match ctx.eval_arg(&args[0])?.into_value() {
        Value::Array(a) => {
            let cells: Vec<Value> = a.cells().iter().map(|c| render(c, strict)).collect();
            match ArrayValue::new(a.rows(), a.cols(), cells) {
                Ok(arr) => Value::Array(arr),
                Err(e) => Value::Error(e),
            }
        }
        v => render(&v, strict),
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
    fn concise_text_unchanged() {
        assert_eq!(t(&eval(r#"=VALUETOTEXT("hello")"#)), "hello");
    }

    #[test]
    fn strict_quotes_text() {
        assert_eq!(t(&eval(r#"=VALUETOTEXT("hello",1)"#)), r#""hello""#);
        assert_eq!(t(&eval(r#"=VALUETOTEXT("a""b",1)"#)), r#""a""b""#);
    }

    #[test]
    fn numbers_format_general() {
        assert_eq!(t(&eval("=VALUETOTEXT(123.5)")), "123.5");
        assert_eq!(t(&eval("=VALUETOTEXT(7)")), "7");
        assert_eq!(t(&eval("=VALUETOTEXT(-0.25,1)")), "-0.25");
    }

    #[test]
    fn booleans() {
        assert_eq!(t(&eval("=VALUETOTEXT(TRUE)")), "TRUE");
        assert_eq!(t(&eval("=VALUETOTEXT(FALSE,1)")), "FALSE");
    }

    #[test]
    fn blank_is_empty() {
        let v = eval_with(&[("A1", Value::Blank)], "=VALUETOTEXT(A1)");
        assert_eq!(t(&v), "");
        let v = eval_with(&[("A1", Value::Blank)], "=VALUETOTEXT(A1,1)");
        assert_eq!(t(&v), "");
    }

    #[test]
    fn error_renders_as_code_text() {
        // SPEC-OPEN: renders instead of propagating.
        assert_eq!(t(&eval("=VALUETOTEXT(#N/A)")), "#N/A");
        assert_eq!(t(&eval("=VALUETOTEXT(1/0)")), "#DIV/0!");
    }

    #[test]
    fn invalid_format_is_error() {
        assert_eq!(e(&eval(r#"=VALUETOTEXT("x",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUETOTEXT("x",-1)"#)), CalcError::Value);
    }

    #[test]
    fn format_truncates() {
        assert_eq!(t(&eval(r#"=VALUETOTEXT("x",1.9)"#)), r#""x""#);
    }

    #[test]
    fn empty_text() {
        assert_eq!(t(&eval(r#"=VALUETOTEXT("")"#)), "");
        assert_eq!(t(&eval(r#"=VALUETOTEXT("",1)"#)), r#""""#);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=VALUETOTEXT()")), CalcError::Value);
        assert_eq!(e(&eval("=VALUETOTEXT(1,0,3)")), CalcError::Value);
    }
}
