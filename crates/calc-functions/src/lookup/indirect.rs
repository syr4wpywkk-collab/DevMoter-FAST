//! `INDIRECT(ref_text, [a1])` — turns reference text into a live
//! reference, dereferenced by the evaluator. Volatile (listed in
//! `registry::VOLATILE_NAMES` — the target is only known at evaluation
//! time, so the dependency graph cannot track it). Spec:
//! `docs/functions/INDIRECT.md`.
//!
//! `a1` = TRUE/omitted parses A1 text via
//! [`EvalContext::ref_from_a1_text`] (sheet-qualified, `$` markers).
//! `a1` = FALSE parses R1C1 text here — `R[2]C[-1]` offsets anchor at
//! the caller cell (`EvalContext::caller`). Defined names are not
//! resolved (SPEC-OPEN in INDIRECT.md). Every failure is `#REF!`.

use calc_core::ast::Expr;
use calc_core::cell::{CellId, CellRef, RangeRef};
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::reference::RefValue;
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let text = match ctx.eval(&args[0])? {
        v if v.is_error() => return Ok(v),
        v => match v.to_text() {
            Ok(t) => t,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    let a1 = match args.get(1) {
        Some(Expr::Missing) | None => true,
        Some(e) => {
            let v = ctx.eval(e)?;
            if v.is_blank() {
                true
            } else {
                match v.to_boolean() {
                    Ok(b) => b,
                    Err(err) => return Ok(Value::Error(err)),
                }
            }
        }
    };
    let result = if a1 {
        ctx.ref_from_a1_text(&text)
    } else {
        r1c1(ctx, &text)
    };
    match result {
        Ok(r) => Ok(Value::Reference(r)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Parse R1C1 reference text relative to `ctx.caller()`:
/// `R2C2`, `R[1]C[-1]`, `RC`, ranges `R1C1:R2C2`, and optional sheet
/// prefixes (`Sheet2!R1C1`, `'My Sheet'!R1C1`). Bare `R`/`C` means
/// offset 0 (the caller's own row/column).
fn r1c1(ctx: &EvalContext<'_>, text: &str) -> Result<RefValue, CalcError> {
    if text.len() > calc_core::MAX_REF_TEXT_LEN {
        return Err(CalcError::Ref);
    }
    let (sheet, body) = split_sheet(text)?;
    let sheet_id = match sheet {
        None => ctx.caller().sheet_id,
        Some(name) => ctx.sheet_index(&name).ok_or(CalcError::Ref)?,
    };
    let mut parts = body.splitn(2, ':');
    let first = parts.next().unwrap_or("");
    let start = r1c1_cell(first, ctx.caller())?;
    let end = match parts.next() {
        Some(second) => r1c1_cell(second, ctx.caller())?,
        None => start,
    };
    Ok(RefValue::new(sheet_id, RangeRef { start, end }))
}

/// Split optional `Sheet!`/`'Sheet Name'!` prefix from reference text;
/// `'` quoting doubles interior quotes. No `!` -> `(None, text)`.
fn split_sheet(text: &str) -> Result<(Option<String>, &str), CalcError> {
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut quoted = false;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' => quoted = !quoted,
            b'!' if !quoted => {
                let raw = &text[..i];
                let name = if raw.starts_with('\'') {
                    let inner = raw
                        .strip_prefix('\'')
                        .and_then(|s| s.strip_suffix('\''))
                        .ok_or(CalcError::Ref)?;
                    inner.replace("''", "'")
                } else {
                    raw.to_string()
                };
                return Ok((Some(name), &text[i + 1..]));
            }
            _ => {}
        }
        i += 1;
    }
    Ok((None, text))
}

/// One `R...C...` cell spec: `R`/`C` followed by digits (absolute,
/// 1-based) or `[signed digits]` (caller-relative) or nothing
/// (caller position).
fn r1c1_cell(s: &str, caller: CellId) -> Result<CellRef, CalcError> {
    let (row, col) = parse_rc(s, caller)?;
    if row < 0
        || col < 0
        || row >= i64::from(calc_core::MAX_ROWS)
        || col >= i64::from(calc_core::MAX_COLS)
    {
        return Err(CalcError::Ref);
    }
    Ok(CellRef {
        row: row as u32,
        col: col as u32,
        row_abs: false,
        col_abs: false,
    })
}

fn parse_rc(s: &str, caller: CellId) -> Result<(i64, i64), CalcError> {
    let b = s.as_bytes();
    if b.first() != Some(&b'R') && b.first() != Some(&b'r') {
        return Err(CalcError::Ref);
    }
    let (row, i) = rc_part(&s[1..], i64::from(caller.row))?;
    let rest = &s[1 + i..];
    let rb = rest.as_bytes();
    if rb.first() != Some(&b'C') && rb.first() != Some(&b'c') {
        return Err(CalcError::Ref);
    }
    let (col, j) = rc_part(&rest[1..], i64::from(caller.col))?;
    if 1 + j != rest.len() {
        return Err(CalcError::Ref);
    }
    Ok((row, col))
}

/// Parse one component after its `R`/`C` letter: `[n]` relative,
/// `n` absolute 1-based, empty = caller position. Returns the 0-based
/// coordinate and bytes consumed.
fn rc_part(s: &str, base: i64) -> Result<(i64, usize), CalcError> {
    if s.starts_with('[') {
        let close = s.find(']').ok_or(CalcError::Ref)?;
        let off: i64 = s[1..close].parse().map_err(|_| CalcError::Ref)?;
        Ok((base + off, close + 1))
    } else {
        let digits = s.len() - s.trim_start_matches(|c: char| c.is_ascii_digit()).len();
        if digits == 0 {
            return Ok((base, 0));
        }
        let n: i64 = s[..digits].parse().map_err(|_| CalcError::Ref)?;
        if n < 1 {
            return Err(CalcError::Ref);
        }
        Ok((n - 1, digits))
    }
}

#[cfg(test)]
mod tests {
    use calc_core::{CalcEngine, CalcError, CellInput, Value};

    fn engine() -> CalcEngine {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.add_sheet("Sheet1").unwrap();
        e
    }

    fn set_num(e: &mut CalcEngine, addr: &str, n: f64) {
        e.set_cell("Sheet1", addr, CellInput::Value(Value::Number(n)))
            .unwrap();
    }

    fn set(e: &mut CalcEngine, addr: &str, input: &str) {
        e.set_cell("Sheet1", addr, CellInput::from_typed(input))
            .unwrap();
    }

    fn get(e: &mut CalcEngine, addr: &str) -> Value {
        e.get_value("Sheet1", addr).unwrap()
    }

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    fn err(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn simple_a1_deref() {
        let mut e = engine();
        set_num(&mut e, "B2", 10.0);
        set(&mut e, "C1", r#"=INDIRECT("B2")"#);
        assert_eq!(n(&get(&mut e, "C1")), 10.0);
    }

    #[test]
    fn concatenated_text() {
        let mut e = engine();
        set_num(&mut e, "B2", 10.0);
        e.set_cell("Sheet1", "A1", CellInput::Value(Value::Text("B".into())))
            .unwrap();
        set(&mut e, "C1", r#"=INDIRECT(A1&"2")"#);
        assert_eq!(n(&get(&mut e, "C1")), 10.0);
    }

    #[test]
    fn absolute_markers() {
        let mut e = engine();
        set_num(&mut e, "B2", 5.0);
        set(&mut e, "C1", r#"=INDIRECT("$B$2")"#);
        assert_eq!(n(&get(&mut e, "C1")), 5.0);
    }

    #[test]
    fn range_spills() {
        let mut e = engine();
        set_num(&mut e, "A1", 1.0);
        set_num(&mut e, "A2", 2.0);
        set_num(&mut e, "A3", 3.0);
        set(&mut e, "C1", "=SUM(INDIRECT(\"A1:A3\"))");
        assert_eq!(n(&get(&mut e, "C1")), 6.0);
    }

    #[test]
    fn sheet_qualified() {
        let mut e = engine();
        e.add_sheet("Sheet2").unwrap();
        e.set_cell("Sheet2", "C1", CellInput::Value(Value::Number(8.0)))
            .unwrap();
        set(&mut e, "A1", r#"=INDIRECT("Sheet2!C1")"#);
        assert_eq!(n(&get(&mut e, "A1")), 8.0);
    }

    #[test]
    fn r1c1_absolute() {
        let mut e = engine();
        set_num(&mut e, "A1", 4.0);
        set(&mut e, "C1", r#"=INDIRECT("R1C1",FALSE)"#);
        assert_eq!(n(&get(&mut e, "C1")), 4.0);
    }

    #[test]
    fn r1c1_relative_to_caller() {
        let mut e = engine();
        set_num(&mut e, "B2", 9.0);
        // C1's caller is C1: R[1]C[-1] -> B2.
        set(&mut e, "C1", r#"=INDIRECT("R[1]C[-1]",FALSE)"#);
        assert_eq!(n(&get(&mut e, "C1")), 9.0);
    }

    #[test]
    fn invalid_text_is_ref() {
        let mut e = engine();
        for (cell, f) in [
            ("B1", r#"=INDIRECT("ZZZ999")"#),
            ("B2", r#"=INDIRECT("nope!")"#),
            ("B3", r#"=INDIRECT("A0")"#),
            ("B4", r#"=INDIRECT("NoSheet!A1")"#),
            ("B5", r#"=INDIRECT(5)"#),
        ] {
            set(&mut e, cell, f);
        }
        for cell in ["B1", "B2", "B3", "B4", "B5"] {
            assert_eq!(err(&get(&mut e, cell)), CalcError::Ref, "{cell}");
        }
    }

    #[test]
    fn volatile_recalculation() {
        let mut e = engine();
        set_num(&mut e, "B2", 10.0);
        set(&mut e, "C1", r#"=INDIRECT("B2")"#);
        assert_eq!(n(&get(&mut e, "C1")), 10.0);
        set_num(&mut e, "B2", 42.0);
        e.recalculate().unwrap();
        assert_eq!(n(&get(&mut e, "C1")), 42.0);
    }

    #[test]
    fn non_boolean_a1_arg() {
        let mut e = engine();
        set(&mut e, "B1", r#"=INDIRECT("A1","x")"#);
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        let mut e = engine();
        set(&mut e, "B1", "=INDIRECT(1/0)");
        assert_eq!(err(&get(&mut e, "B1")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        let mut e = engine();
        set(&mut e, "B1", "=INDIRECT()");
        set(&mut e, "B2", r#"=INDIRECT("A1",TRUE,1)"#);
        assert_eq!(err(&get(&mut e, "B1")), CalcError::Value);
        assert_eq!(err(&get(&mut e, "B2")), CalcError::Value);
    }
}
