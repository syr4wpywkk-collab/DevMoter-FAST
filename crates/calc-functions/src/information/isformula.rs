//! `ISFORMULA(reference)` — TRUE when `reference` points to a cell
//! containing a formula (checked against stored input, so a formula
//! returning an error still counts). A non-reference argument is
//! `#VALUE!`. Spec: `docs/functions/ISFORMULA.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval_ref(&args[0])? {
        Ok(r) => Ok(Value::Boolean(ctx.cell_is_formula(r.top_left()))),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use calc_core::{CalcEngine, CalcError, CellInput, Value};

    fn b(v: &Value) -> bool {
        match v {
            Value::Boolean(b) => *b,
            o => panic!("expected bool, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    /// Engine with `Sheet1` plus `(address, CellInput)` cells, then a
    /// scratch formula evaluation.
    fn eval_on(cells: &[(&str, &str)], formula: &str) -> Value {
        let mut engine = CalcEngine::new();
        engine.set_registry(Box::new(crate::registry::default_registry()));
        engine.add_sheet("Sheet1").unwrap();
        for (addr, input) in cells {
            engine
                .set_cell("Sheet1", addr, CellInput::from_typed(input))
                .unwrap();
        }
        engine.eval_formula("Sheet1", formula).unwrap()
    }

    #[test]
    fn formula_cell_true() {
        assert!(b(&eval_on(&[("A1", "=1+1")], "=ISFORMULA(A1)")));
        assert!(b(&eval_on(&[("A1", "=SUM(B1:B3)")], "=ISFORMULA(A1)")));
    }

    #[test]
    fn literal_cells_false() {
        assert!(!b(&eval_on(&[("A2", "42")], "=ISFORMULA(A2)")));
        assert!(!b(&eval_on(&[("A2", "text")], "=ISFORMULA(A2)")));
        assert!(!b(&eval_on(&[("A2", "TRUE")], "=ISFORMULA(A2)")));
    }

    #[test]
    fn empty_cell_false() {
        assert!(!b(&eval_on(&[], "=ISFORMULA(A1)")));
    }

    #[test]
    fn error_formula_cell_true() {
        // The cell holds a formula even though its value is an error.
        assert!(b(&eval_on(&[("A3", "=1/0")], "=ISFORMULA(A3)")));
    }

    #[test]
    fn empty_string_formula_true() {
        // `=""` is a formula returning empty text, not a literal.
        assert!(b(&eval_on(&[("A1", r#"="""#)], "=ISFORMULA(A1)")));
    }

    #[test]
    fn non_reference_is_value() {
        assert_eq!(e(&eval_on(&[], "=ISFORMULA(5)")), CalcError::Value);
        assert_eq!(e(&eval_on(&[], r#"=ISFORMULA("A1")"#)), CalcError::Value);
        assert_eq!(e(&eval_on(&[], "=ISFORMULA(TRUE)")), CalcError::Value);
    }

    #[test]
    fn range_checks_top_left() {
        // SPEC-OPEN: multi-cell range semantics; top-left cell is used.
        assert!(b(&eval_on(&[("A1", "=1")], "=ISFORMULA(A1:B2)")));
        assert!(!b(&eval_on(&[("B2", "=1")], "=ISFORMULA(A1:B2)")));
    }

    #[test]
    fn missing_sheet_ref() {
        assert_eq!(e(&eval_on(&[], "=ISFORMULA(Nosuch!A1)")), CalcError::Ref);
    }

    #[test]
    fn error_result_of_expression() {
        assert_eq!(e(&eval_on(&[], "=ISFORMULA(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn stored_formula_evaluates() {
        // Driven through the engine's stored-cell path, not just the
        // scratch `eval_formula` path.
        let mut engine = CalcEngine::new();
        engine.set_registry(Box::new(crate::registry::default_registry()));
        engine.add_sheet("Sheet1").unwrap();
        engine
            .set_cell("Sheet1", "A1", CellInput::from_typed("=1+1"))
            .unwrap();
        engine
            .set_cell("Sheet1", "C5", CellInput::from_typed("=ISFORMULA(A1)"))
            .unwrap();
        assert_eq!(
            engine.get_value("Sheet1", "C5").unwrap(),
            Value::Boolean(true)
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval_on(&[], "=ISFORMULA()")), CalcError::Value);
        assert_eq!(e(&eval_on(&[], "=ISFORMULA(A1,B1)")), CalcError::Value);
    }
}
