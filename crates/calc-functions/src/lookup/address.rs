//! `ADDRESS(row_num, column_num, [abs_num], [a1], [sheet_text])` —
//! the text of a cell reference built from numeric row/column indexes.
//! Spec: `docs/functions/ADDRESS.md`.
//!
//! R1C1 relative forms take `row_num`/`column_num` as the literal
//! bracketed offsets (`ADDRESS(3,2,4,FALSE)` -> `"R[3]C[2]"` — the
//! numbers are interpreted as offsets from the caller at use time, so
//! no caller-position arithmetic is needed here). Sheet-name
//! quoting follows the common rule (quote when non-alphanumeric or
//! leading digit, escape `'` as `''`) — flagged SPEC-OPEN in the spec.

use calc_core::ast::Expr;
use calc_core::cell::col_to_letters;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 5) {
        return Ok(Value::Error(e));
    }
    let row = match num(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r,
    };
    let col = match num(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    if row < 1
        || col < 1
        || row > i64::from(calc_core::MAX_ROWS)
        || col > i64::from(calc_core::MAX_COLS)
    {
        return Ok(Value::Error(CalcError::Value));
    }
    let abs = match int_opt(ctx, args.get(2), 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    if !(1..=4).contains(&abs) {
        return Ok(Value::Error(CalcError::Value));
    }
    let a1 = match bool_opt(ctx, args.get(3), true)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let sheet = match args.get(4) {
        Some(Expr::Missing) | None => None,
        Some(e) => match ctx.eval(e)?.to_text() {
            Ok(t) => Some(t),
            Err(err) => return Ok(Value::Error(err)),
        },
    };

    // abs: 1 = $R$C, 2 = row abs only, 3 = col abs only, 4 = relative.
    let (row_abs, col_abs) = (abs == 1 || abs == 2, abs == 1 || abs == 3);
    let body = if a1 {
        format!(
            "{}{}{}{}",
            if col_abs { "$" } else { "" },
            col_to_letters(col as u32 - 1),
            if row_abs { "$" } else { "" },
            row
        )
    } else {
        format!(
            "{}{}",
            r1c1_part("R", row, row_abs, row),
            r1c1_part("C", col, col_abs, col)
        )
    };
    let text = match sheet.filter(|s| !s.is_empty()) {
        Some(name) => format!("{}!{body}", quote_sheet(&name)),
        None => body,
    };
    Ok(Value::Text(text))
}

/// One `R`/`C` component: absolute is the bare 1-based index,
/// relative is `[+offset]`/`[-offset]`, bare letter for offset 0.
fn r1c1_part(letter: &str, pos: i64, abs: bool, offset: i64) -> String {
    if abs {
        format!("{letter}{pos}")
    } else if offset == 0 {
        letter.to_string()
    } else {
        format!("{letter}[{offset}]")
    }
}

/// Quote a sheet name when it contains anything outside
/// `[A-Za-z0-9_.]` or starts with a digit (SPEC-OPEN quoting rules).
fn quote_sheet(name: &str) -> String {
    let needs_quote = name.chars().next().is_some_and(|c| c.is_ascii_digit())
        || name
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '_' || c == '.'));
    if needs_quote {
        format!("'{}'", name.replace('\'', "''"))
    } else {
        name.to_string()
    }
}

fn num(ctx: &mut EvalContext<'_>, expr: &Expr) -> Result<Result<i64, CalcError>, EvalError> {
    let v = ctx.eval(expr)?;
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    Ok(v.to_number().map(|n| n.trunc() as i64))
}

fn int_opt(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: i64,
) -> Result<Result<i64, CalcError>, EvalError> {
    match expr {
        Some(Expr::Missing) | None => Ok(Ok(default)),
        Some(e) => {
            let v = ctx.eval(e)?;
            if v.is_blank() {
                return Ok(Ok(default));
            }
            num(ctx, e)
        }
    }
}

fn bool_opt(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: bool,
) -> Result<Result<bool, CalcError>, EvalError> {
    match expr {
        Some(Expr::Missing) | None => Ok(Ok(default)),
        Some(e) => {
            let v = ctx.eval(e)?;
            if v.is_blank() {
                return Ok(Ok(default));
            }
            // ADDRESS.md: a non-boolean `a1` scalar is `#VALUE!` — no
            // numeric/text coercion for this flag.
            Ok(match v {
                Value::Boolean(b) => Ok(b),
                Value::Error(err) => Err(err),
                _ => Err(CalcError::Value),
            })
        }
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
    fn absolute_default() {
        assert_eq!(t(&eval("=ADDRESS(3,2)")), "$B$3");
    }

    #[test]
    fn abs_modes() {
        assert_eq!(t(&eval("=ADDRESS(3,2,1)")), "$B$3");
        assert_eq!(t(&eval("=ADDRESS(3,2,2)")), "B$3");
        assert_eq!(t(&eval("=ADDRESS(3,2,3)")), "$B3");
        assert_eq!(t(&eval("=ADDRESS(3,2,4)")), "B3");
    }

    #[test]
    fn r1c1_modes() {
        // row_num/column_num are the literal bracketed offsets.
        assert_eq!(t(&eval("=ADDRESS(3,2,1,FALSE)")), "R3C2");
        assert_eq!(t(&eval("=ADDRESS(3,2,2,FALSE)")), "R3C[2]");
        assert_eq!(t(&eval("=ADDRESS(3,2,3,FALSE)")), "R[3]C2");
        assert_eq!(t(&eval("=ADDRESS(3,2,4,FALSE)")), "R[3]C[2]");
    }

    #[test]
    fn r1c1_relative_args_are_literal_offsets() {
        // ADDRESS(1,1,4,FALSE) -> "R[1]C[1]": the numbers are the
        // bracketed offsets verbatim (per ADDRESS.md worked example);
        // a bare "RC" would need offset 0, which row/col validation
        // rejects before rendering.
        assert_eq!(t(&eval("=ADDRESS(1,1,4,FALSE)")), "R[1]C[1]");
    }

    #[test]
    fn sheet_prefix() {
        assert_eq!(
            t(&eval(r#"=ADDRESS(3,2,1,TRUE,"My Sheet")"#)),
            "'My Sheet'!$B$3"
        );
        assert_eq!(t(&eval(r#"=ADDRESS(3,2,1,TRUE,"Data")"#)), "Data!$B$3");
    }

    #[test]
    fn sheet_starting_with_digit_is_quoted() {
        assert_eq!(
            t(&eval(r#"=ADDRESS(1,1,1,TRUE,"2024 Plan")"#)),
            "'2024 Plan'!$A$1"
        );
    }

    #[test]
    fn out_of_range_indexes() {
        assert_eq!(e(&eval("=ADDRESS(0,1)")), CalcError::Value);
        assert_eq!(e(&eval("=ADDRESS(1,0)")), CalcError::Value);
        assert_eq!(e(&eval("=ADDRESS(1,16385)")), CalcError::Value);
        assert_eq!(e(&eval("=ADDRESS(1048577,1)")), CalcError::Value);
    }

    #[test]
    fn bad_abs_num() {
        assert_eq!(e(&eval("=ADDRESS(1,1,0)")), CalcError::Value);
        assert_eq!(e(&eval("=ADDRESS(1,1,5)")), CalcError::Value);
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(t(&eval("=ADDRESS(3.9,2.1)")), "$B$3");
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(t(&eval(r#"=ADDRESS("3","2")"#)), "$B$3");
    }

    #[test]
    fn non_numeric() {
        assert_eq!(e(&eval(r#"=ADDRESS("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval("=ADDRESS(1,1,1,2)")), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=ADDRESS(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ADDRESS(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=ADDRESS(1)")), CalcError::Value);
        assert_eq!(e(&eval("=ADDRESS(1,1,1,1,1,1)")), CalcError::Value);
    }
}
