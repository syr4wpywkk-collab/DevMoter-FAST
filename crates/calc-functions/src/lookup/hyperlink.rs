//! `HYPERLINK(link_location, [friendly_name])` — pure-value form:
//! returns `friendly_name` (keeping its own type) or the
//! `link_location` text when omitted. Spec: `docs/functions/HYPERLINK.md`.
//!
//! The link target itself is cell metadata a value-only engine cannot
//! store — the hyperlink is dropped with this documented caveat
//! (HYPERLINK.md "Engine requirements"). No navigation is performed,
//! and URL validity is not checked (Excel defers that to click time).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let link = match coercion::eval_text(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    match args.get(1) {
        Some(Expr::Missing) | None => Ok(Value::Text(link)),
        Some(e) => ctx.eval(e),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> String {
        match v {
            Value::Text(s) => s.clone(),
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
    fn friendly_name_returned() {
        assert_eq!(
            t(&eval(r#"=HYPERLINK("https://example.com","Example")"#)),
            "Example"
        );
    }

    #[test]
    fn link_is_default_display() {
        assert_eq!(
            t(&eval(r#"=HYPERLINK("https://example.com")"#)),
            "https://example.com"
        );
    }

    #[test]
    fn internal_link() {
        assert_eq!(t(&eval(r##"=HYPERLINK("#'Sheet 2'!B5","Go")"##)), "Go");
    }

    #[test]
    fn numeric_friendly_name_keeps_type() {
        assert_eq!(
            eval(r#"=HYPERLINK("https://example.com",42)"#),
            Value::Number(42.0)
        );
    }

    #[test]
    fn boolean_friendly_name_keeps_type() {
        assert_eq!(
            eval(r#"=HYPERLINK("https://example.com",TRUE)"#),
            Value::Boolean(true)
        );
    }

    #[test]
    fn error_friendly_name_propagates() {
        assert_eq!(
            e(&eval(r#"=HYPERLINK("https://x",1/0)"#)),
            CalcError::DivZero
        );
        assert_eq!(e(&eval(r#"=HYPERLINK("https://x",#N/A)"#)), CalcError::NA);
    }

    #[test]
    fn error_link_location_propagates() {
        assert_eq!(e(&eval("=HYPERLINK(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn numeric_link_coerces_to_text() {
        assert_eq!(t(&eval("=HYPERLINK(42)")), "42");
    }

    #[test]
    fn friendly_name_from_cell() {
        let v = eval_with(
            &[("A1", Value::Text("click".into()))],
            r#"=HYPERLINK("https://x",A1)"#,
        );
        assert_eq!(t(&v), "click");
    }

    #[test]
    fn empty_friendly_name() {
        assert_eq!(t(&eval(r#"=HYPERLINK("https://x","")"#)), "");
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=HYPERLINK()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=HYPERLINK("a","b","c")"#)), CalcError::Value);
    }
}
