//! `FORMULATEXT(reference)` — the stored formula text of the
//! referenced cell, including the leading `=`. Spec:
//! `docs/functions/FORMULATEXT.md`.
//!
//! Multi-cell references read the top-left cell (spec open question).
//! The stored text is the formula as entered, minus the engine's
//! storage `=` — this function re-adds it. A non-formula cell is
//! `#N/A`; a non-reference argument is `#VALUE!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let r = match ctx.eval_ref(&args[0])? {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    match ctx.cell_formula_text(r.top_left()) {
        Some(text) => Ok(Value::Text(format!("={text}"))),
        None => Ok(Value::Error(CalcError::NA)),
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

    fn set(e: &mut CalcEngine, addr: &str, input: &str) {
        e.set_cell("Sheet1", addr, CellInput::from_typed(input))
            .unwrap();
    }

    fn eval(e: &mut CalcEngine, formula: &str) -> Value {
        e.eval_formula("Sheet1", formula).unwrap()
    }

    fn t(v: &Value) -> String {
        match v {
            Value::Text(s) => s.clone(),
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn err(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn returns_formula_with_equals() {
        let mut e = engine();
        set(&mut e, "B2", "=A1*2");
        assert_eq!(t(&eval(&mut e, "=FORMULATEXT(B2)")), "=A1*2");
    }

    #[test]
    fn literal_cell_is_na() {
        let mut e = engine();
        set(&mut e, "B2", "42");
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT(B2)")), CalcError::NA);
    }

    #[test]
    fn blank_cell_is_na() {
        let mut e = engine();
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT(A1)")), CalcError::NA);
    }

    #[test]
    fn range_reads_top_left() {
        let mut e = engine();
        set(&mut e, "B2", "=1+1");
        assert_eq!(t(&eval(&mut e, "=FORMULATEXT(B2:B3)")), "=1+1");
    }

    #[test]
    fn non_reference_argument() {
        let mut e = engine();
        assert_eq!(
            err(&eval(&mut e, r#"=FORMULATEXT("=1+1")"#)),
            CalcError::Value
        );
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT(5)")), CalcError::Value);
    }

    #[test]
    fn error_argument_propagates() {
        let mut e = engine();
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn works_through_indirect() {
        let mut e = engine();
        set(&mut e, "C3", "=SUM(1,2)");
        assert_eq!(
            t(&eval(&mut e, r#"=FORMULATEXT(INDIRECT("C3"))"#)),
            "=SUM(1,2)"
        );
    }

    #[test]
    fn self_reference_returns_own_text() {
        let mut e = engine();
        // Formula text, not value, is read — no circularity.
        set(&mut e, "A1", "=FORMULATEXT(A1)");
        e.recalculate().unwrap();
        assert_eq!(
            e.get_value("Sheet1", "A1").unwrap(),
            Value::Text("=FORMULATEXT(A1)".into())
        );
    }

    #[test]
    fn preserves_entered_text() {
        let mut e = engine();
        set(&mut e, "B1", "=  SUM( A1 , 2 )");
        assert_eq!(t(&eval(&mut e, "=FORMULATEXT(B1)")), "=  SUM( A1 , 2 )");
    }

    #[test]
    fn text_constant_is_na() {
        let mut e = engine();
        set(&mut e, "B1", "hello");
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT(B1)")), CalcError::NA);
    }

    #[test]
    fn arity() {
        let mut e = engine();
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT()")), CalcError::Value);
        assert_eq!(err(&eval(&mut e, "=FORMULATEXT(A1,A2)")), CalcError::Value);
    }
}
