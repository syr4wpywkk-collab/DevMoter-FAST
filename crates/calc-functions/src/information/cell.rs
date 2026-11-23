//! `CELL(info_type, [reference])` — formatting/location/content
//! information about a cell. Spec: `docs/functions/CELL.md`.
//!
//! The engine has no formatting or persistence layer, so only the
//! value-modelled info_types are implemented:
//!
//! | info_type    | result                                            |
//! |--------------|---------------------------------------------------|
//! | `address`    | absolute `$A$1` text (sheet-qualified when the    |
//! |              | reference is on another sheet)                    |
//! | `col`/`row`  | 1-based column/row of the reference's top-left    |
//! | `contents`   | the referenced cell's value                        |
//! | `type`       | `"b"` blank, `"l"` label (text), `"v"` anything   |
//! |              | else                                               |
//! | `filename`   | `""` — no persistence layer exists                |
//!
//! Documented info_types that need metadata this engine does not
//! model (`color`, `coord`, `format`, `parentheses`, `prefix`,
//! `protect`, `width`) return `#N/A`; unknown info_types return
//! `#VALUE!` (SPEC-OPEN: exact error for known-but-unmodelled types).
//! An omitted `reference` uses the calling cell (SPEC-OPEN: Excel's
//! default is the "last cell changed", meaningless headless).

use calc_core::ast::Expr;
use calc_core::cell::{CellRef, col_to_letters};
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::reference::RefValue;
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// info_types implemented by the value model.
const SUPPORTED: &[&str] = &["address", "col", "contents", "filename", "row", "type"];

/// Documented info_types that need formatting/metadata layers.
const UNSUPPORTED: &[&str] = &[
    "color",
    "coord",
    "format",
    "parentheses",
    "prefix",
    "protect",
    "width",
];

fn caller_ref(ctx: &EvalContext<'_>) -> RefValue {
    let c = ctx.caller();
    RefValue::single(
        c.sheet_id,
        CellRef {
            row: c.row,
            col: c.col,
            row_abs: false,
            col_abs: false,
        },
    )
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let info_type = match ctx.eval(&args[0])?.to_text() {
        Ok(t) => t.to_ascii_lowercase(),
        Err(e) => return Ok(Value::Error(e)),
    };
    let reference = match args.get(1) {
        None | Some(Expr::Missing) => caller_ref(ctx),
        Some(expr) => match ctx.eval_ref(expr)? {
            Ok(r) => r,
            Err(e) => return Ok(Value::Error(e)),
        },
    };

    match info_type.as_str() {
        "address" => {
            let c = reference.range.start;
            let mut s = String::new();
            if reference.sheet_id != ctx.caller().sheet_id {
                if let Some(name) = ctx.sheet_name(reference.sheet_id) {
                    s.push('\'');
                    s.push_str(name);
                    s.push_str("'!");
                }
            }
            s.push('$');
            s.push_str(&col_to_letters(c.col));
            s.push('$');
            s.push_str(&(c.row + 1).to_string());
            Ok(Value::Text(s))
        }
        "col" => Ok(Value::Number(f64::from(reference.range.start.col) + 1.0)),
        "row" => Ok(Value::Number(f64::from(reference.range.start.row) + 1.0)),
        "contents" | "type" => {
            let single = RefValue::single(reference.sheet_id, reference.range.start);
            let v = ctx.deref(&single)?.into_value();
            if info_type == "contents" {
                Ok(v)
            } else {
                Ok(Value::Text(
                    match v {
                        Value::Blank => "b",
                        Value::Text(_) => "l",
                        _ => "v",
                    }
                    .into(),
                ))
            }
        }
        // No persistence layer: the workbook was never "saved".
        "filename" => Ok(Value::Text(String::new())),
        _ if UNSUPPORTED.contains(&info_type.as_str()) => Ok(Value::Error(CalcError::NA)),
        _ if SUPPORTED.contains(&info_type.as_str()) => unreachable!(),
        _ => Ok(Value::Error(CalcError::Value)),
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
    fn row_and_col() {
        assert_eq!(n(&eval(r#"=CELL("row",B7)"#)), 7.0);
        assert_eq!(n(&eval(r#"=CELL("col",B7)"#)), 2.0);
    }

    #[test]
    fn address_same_sheet() {
        assert_eq!(t(&eval(r#"=CELL("address",C3)"#)), "$C$3");
        assert_eq!(t(&eval(r#"=CELL("address",AA100)"#)), "$AA$100");
    }

    #[test]
    fn type_codes() {
        assert_eq!(
            t(&eval_with(&[("A1", "x".into())], r#"=CELL("type",A1)"#)),
            "l"
        );
        assert_eq!(t(&eval(r#"=CELL("type",A2)"#)), "b");
        assert_eq!(
            t(&eval_with(&[("A3", 5.0.into())], r#"=CELL("type",A3)"#)),
            "v"
        );
        assert_eq!(
            t(&eval_with(
                &[("A4", Value::Boolean(true))],
                r#"=CELL("type",A4)"#
            )),
            "v"
        );
    }

    #[test]
    fn contents_returns_value() {
        assert_eq!(
            n(&eval_with(
                &[("A1", 42.0.into())],
                r#"=CELL("contents",A1)"#
            )),
            42.0
        );
        assert_eq!(
            t(&eval_with(
                &[("A1", "hi".into())],
                r#"=CELL("contents",A1)"#
            )),
            "hi"
        );
        assert!(eval(r#"=CELL("contents",A9)"#).is_blank());
    }

    #[test]
    fn range_uses_top_left() {
        assert_eq!(n(&eval(r#"=CELL("row",C5:E9)"#)), 5.0);
        assert_eq!(n(&eval(r#"=CELL("col",C5:E9)"#)), 3.0);
        assert_eq!(t(&eval(r#"=CELL("address",C5:E9)"#)), "$C$5");
    }

    #[test]
    fn case_insensitive_info_type() {
        assert_eq!(n(&eval(r#"=CELL("ROW",B7)"#)), 7.0);
        assert_eq!(n(&eval(r#"=CELL("Col",B7)"#)), 2.0);
    }

    #[test]
    fn filename_empty() {
        // SPEC-OPEN: no file-path concept; documented constant "".
        assert_eq!(t(&eval(r#"=CELL("filename",A1)"#)), "");
    }

    #[test]
    fn unmodelled_info_types_na() {
        for it in [
            "color",
            "format",
            "parentheses",
            "prefix",
            "protect",
            "width",
            "coord",
        ] {
            assert_eq!(
                e(&eval(&format!(r#"=CELL("{it}",A1)"#))),
                CalcError::NA,
                "{it}"
            );
        }
    }

    #[test]
    fn unknown_info_type_value() {
        assert_eq!(e(&eval(r#"=CELL("bogus",A1)"#)), CalcError::Value);
    }

    #[test]
    fn non_reference_value() {
        assert_eq!(e(&eval(r#"=CELL("row",5)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=CELL("row","A1")"#)), CalcError::Value);
    }

    #[test]
    fn omitted_reference_uses_caller() {
        // SPEC-OPEN: headless "last changed cell" — caller is used.
        // `eval_formula` evaluates on a scratch caller at A1, so the
        // defaults below reflect that position.
        assert_eq!(n(&eval(r#"=CELL("row")"#)), 1.0);
        assert_eq!(n(&eval(r#"=CELL("col")"#)), 1.0);
        assert_eq!(t(&eval(r#"=CELL("type")"#)), "b");
        assert_eq!(t(&eval(r#"=CELL("address")"#)), "$A$1");
    }

    #[test]
    fn info_type_error_propagates() {
        assert_eq!(e(&eval("=CELL(1/0,A1)")), CalcError::DivZero);
    }

    #[test]
    fn missing_sheet_ref() {
        assert_eq!(e(&eval(r#"=CELL("row",Nosuch!A1)"#)), CalcError::Ref);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CELL()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=CELL("row",A1,2)"#)), CalcError::Value);
    }
}
