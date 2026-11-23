//! `INFO(type_text)` — information about the operating environment.
//! Spec: `docs/functions/INFO.md`.
//!
//! A headless engine has no host spreadsheet application, so every
//! supported `type_text` returns a spec-fixed documented constant
//! rather than fabricated host data (all SPEC-OPEN — see the table and
//! `docs/SPEC-OPEN.md`):
//!
//! | type_text    | result                                            |
//! |--------------|---------------------------------------------------|
//! | `directory`  | `""` (no filesystem working directory)            |
//! | `numfile`    | `1` (single-workbook engine)                      |
//! | `origin`     | `"$A:$A$1"` (no scroll state)                     |
//! | `osversion`  | host `std::env::consts::OS` text                  |
//! | `recalc`     | `"Automatic"` (only automatic mode exists)        |
//! | `release`    | this crate's version string                       |
//! | `system`     | `std::env::consts::FAMILY` (`"unix"`/`"windows"`) |
//!
//! Unknown `type_text` returns `#N/A` (SPEC-OPEN: some references say
//! `#VALUE!`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let type_text = match ctx.eval(&args[0])?.to_text() {
        Ok(t) => t.to_ascii_lowercase(),
        Err(e) => return Ok(Value::Error(e)),
    };
    let text = |s: &str| Ok(Value::Text(s.to_string()));
    match type_text.as_str() {
        "directory" => text(""),
        "numfile" => Ok(Value::Number(1.0)),
        "origin" => text("$A:$A$1"),
        "osversion" => text(std::env::consts::OS),
        "recalc" => text("Automatic"),
        "release" => text(env!("CARGO_PKG_VERSION")),
        "system" => text(std::env::consts::FAMILY),
        _ => Ok(Value::Error(CalcError::NA)),
    }
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
    fn numfile_is_one() {
        assert_eq!(n(&eval(r#"=INFO("numfile")"#)), 1.0);
    }

    #[test]
    fn recalc_automatic() {
        assert_eq!(t(&eval(r#"=INFO("recalc")"#)), "Automatic");
    }

    #[test]
    fn directory_empty() {
        assert_eq!(t(&eval(r#"=INFO("directory")"#)), "");
    }

    #[test]
    fn origin_fixed() {
        assert_eq!(t(&eval(r#"=INFO("origin")"#)), "$A:$A$1");
    }

    #[test]
    fn release_is_crate_version() {
        assert_eq!(t(&eval(r#"=INFO("release")"#)), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn system_and_osversion_nonempty() {
        assert!(!t(&eval(r#"=INFO("system")"#)).is_empty());
        assert!(!t(&eval(r#"=INFO("osversion")"#)).is_empty());
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(n(&eval(r#"=INFO("NUMFILE")"#)), 1.0);
        assert_eq!(t(&eval(r#"=INFO("Recalc")"#)), "Automatic");
    }

    #[test]
    fn unknown_type_text_na() {
        assert_eq!(e(&eval(r#"=INFO("bogus")"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=INFO("")"#)), CalcError::NA);
    }

    #[test]
    fn numeric_type_text_coerced() {
        // Numbers coerce to text first, then lookup fails -> #N/A.
        assert_eq!(e(&eval("=INFO(5)")), CalcError::NA);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=INFO(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=INFO(NA())")), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=INFO()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=INFO("a","b")"#)), CalcError::Value);
    }
}
