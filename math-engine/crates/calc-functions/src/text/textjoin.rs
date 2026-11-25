//! `TEXTJOIN(delimiter, ignore_empty, text1, [text2], ...)` — joins
//! strings/ranges with a delimiter. Spec: `docs/functions/TEXTJOIN.md`.
//!
//! Arguments flatten left-to-right, row-major. `ignore_empty` skips
//! `Blank` values only: `Text("")` is *not* blank (plan §3.1) and stays
//! even when `ignore_empty` is TRUE — a spec doc open question marked
//! in fixtures. Errors propagate. Results are capped at Excel's
//! 32,767-character cell limit, reported as `#CALC!` (the spec's
//! documented Excel behavior; error-kind choice is an open question).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

/// Excel's maximum cell text length.
const MAX_TEXT_LEN: usize = 32_767;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let delim = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let ignore_empty = match ctx.eval(&args[1])?.to_boolean() {
        Ok(b) => b,
        Err(e) => return Ok(Value::Error(e)),
    };
    let mut parts: Vec<String> = Vec::new();
    for (v, _) in coercion::flatten_args(ctx, &args[2..])? {
        if let Err(e) = collect(&v, ignore_empty, &mut parts) {
            return Ok(Value::Error(e));
        }
    }
    let joined = parts.join(&delim);
    if joined.len() > MAX_TEXT_LEN {
        return Ok(Value::Error(CalcError::Calc));
    }
    Ok(Value::Text(joined))
}

/// Flatten `v` (arrays recurse row-major) into `parts`.
fn collect(v: &Value, ignore_empty: bool, parts: &mut Vec<String>) -> Result<(), CalcError> {
    match v {
        Value::Array(a) => {
            for cell in a.iter() {
                collect(cell, ignore_empty, parts)?;
            }
            Ok(())
        }
        Value::Blank if ignore_empty => Ok(()),
        _ => match v.to_text() {
            Ok(s) => {
                parts.push(s);
                Ok(())
            }
            Err(e) => Err(e),
        },
    }
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
    fn basic() {
        assert_eq!(t(&eval(r#"=TEXTJOIN(",",TRUE,"a","b","c")"#)), "a,b,c");
    }

    #[test]
    fn empty_delimiter() {
        assert_eq!(t(&eval(r#"=TEXTJOIN("",TRUE,"a","b")"#)), "ab");
    }

    #[test]
    fn range_row_major() {
        let v = eval_with(
            &[("A1", "a".into()), ("B1", "b".into()), ("A2", "c".into())],
            r#"=TEXTJOIN("-",TRUE,A1:B2)"#,
        );
        assert_eq!(t(&v), "a-b-c");
    }

    #[test]
    fn ignore_empty_skips_blanks() {
        let v = eval_with(
            &[("A1", "a".into()), ("A3", "c".into())],
            "=TEXTJOIN(\",\",TRUE,A1:A3)",
        );
        assert_eq!(t(&v), "a,c");
    }

    #[test]
    fn ignore_false_keeps_blank_segment() {
        let v = eval_with(
            &[("A1", "a".into()), ("A3", "c".into())],
            "=TEXTJOIN(\",\",FALSE,A1:A3)",
        );
        assert_eq!(t(&v), "a,,c");
    }

    #[test]
    fn empty_string_is_not_blank() {
        // "" stays a segment even with ignore_empty TRUE (Blank vs "").
        assert_eq!(t(&eval(r#"=TEXTJOIN(" ",TRUE,"a","","b")"#)), "a  b");
    }

    #[test]
    fn numbers_and_booleans_coerce() {
        assert_eq!(t(&eval(r#"=TEXTJOIN(",",TRUE,1,2.5,TRUE)"#)), "1,2.5,TRUE");
    }

    #[test]
    fn delimiter_coerces() {
        assert_eq!(t(&eval(r#"=TEXTJOIN(0,TRUE,"a","b")"#)), "a0b");
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", "x".into())],
            "=TEXTJOIN(\",\",TRUE,A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(
            e(&eval(r#"=TEXTJOIN(",",TRUE,"a",1/0)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn ignore_empty_coerces() {
        assert_eq!(t(&eval(r#"=TEXTJOIN(",",1,"a","b")"#)), "a,b");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=TEXTJOIN(",",TRUE)"#)), CalcError::Value);
    }
}
