//! `SHEET([reference])` — 1-based position of the worksheet containing
//! `reference`, or of the calling sheet when omitted. Accepts a
//! reference (`Sheet2!A1`) or a bare sheet name as text
//! (`SHEET("Sheet2")`). Hidden sheets count (this engine has no
//! hidden-sheet concept anyway). Unknown sheets are `#REF!`.
//! Spec: `docs/functions/SHEET.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 1) {
        return Ok(Value::Error(e));
    }
    let sheet_id = match args.first() {
        None | Some(Expr::Missing) => ctx.caller().sheet_id,
        Some(expr @ (Expr::CellRef { .. } | Expr::RangeRef { .. })) => match ctx.eval_ref(expr)? {
            Ok(r) => r.sheet_id,
            Err(e) => return Ok(Value::Error(e)),
        },
        Some(expr) => match ctx.eval(expr)? {
            Value::Text(name) => match ctx.sheet_index(&name) {
                Some(id) => id,
                None => return Ok(Value::Error(CalcError::Ref)),
            },
            Value::Reference(r) => r.sheet_id,
            Value::Error(e) => return Ok(Value::Error(e)),
            _ => return Ok(Value::Error(CalcError::Value)),
        },
    };
    Ok(Value::Number(f64::from(sheet_id) + 1.0))
}

#[cfg(test)]
mod tests {
    use calc_core::{CalcEngine, CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn engine3() -> CalcEngine {
        let mut engine = CalcEngine::new();
        engine.set_registry(Box::new(crate::registry::default_registry()));
        engine.add_sheet("Sheet1").unwrap();
        engine.add_sheet("Sheet2").unwrap();
        engine.add_sheet("Sheet3").unwrap();
        engine
    }

    #[test]
    fn omitted_is_calling_sheet() {
        let mut engine = engine3();
        assert_eq!(n(&engine.eval_formula("Sheet1", "=SHEET()").unwrap()), 1.0);
        assert_eq!(n(&engine.eval_formula("Sheet2", "=SHEET()").unwrap()), 2.0);
        assert_eq!(n(&engine.eval_formula("Sheet3", "=SHEET()").unwrap()), 3.0);
    }

    #[test]
    fn cross_sheet_reference() {
        let mut engine = engine3();
        assert_eq!(
            n(&engine.eval_formula("Sheet1", "=SHEET(Sheet2!A1)").unwrap()),
            2.0
        );
        assert_eq!(
            n(&engine
                .eval_formula("Sheet1", "=SHEET(Sheet3!B7:D9)")
                .unwrap()),
            3.0
        );
    }

    #[test]
    fn same_sheet_reference() {
        let mut engine = engine3();
        assert_eq!(
            n(&engine.eval_formula("Sheet2", "=SHEET(A1)").unwrap()),
            2.0
        );
        assert_eq!(
            n(&engine.eval_formula("Sheet2", "=SHEET(Sheet2!A1)").unwrap()),
            2.0
        );
    }

    #[test]
    fn sheet_name_text() {
        // SPEC-OPEN: Excel accepts a bare sheet-name text argument.
        let mut engine = engine3();
        assert_eq!(
            n(&engine
                .eval_formula("Sheet1", r#"=SHEET("Sheet3")"#)
                .unwrap()),
            3.0
        );
    }

    #[test]
    fn unknown_sheet_ref() {
        let mut engine = engine3();
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEET(Sheet9!A1)").unwrap()),
            CalcError::Ref
        );
    }

    #[test]
    fn unknown_sheet_name_text() {
        let mut engine = engine3();
        assert_eq!(
            e(&engine.eval_formula("Sheet1", r#"=SHEET("Nope")"#).unwrap()),
            CalcError::Ref
        );
    }

    #[test]
    fn non_ref_scalar_is_value() {
        let mut engine = engine3();
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEET(5)").unwrap()),
            CalcError::Value
        );
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEET(TRUE)").unwrap()),
            CalcError::Value
        );
    }

    #[test]
    fn error_arg_propagates() {
        let mut engine = engine3();
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEET(1/0)").unwrap()),
            CalcError::DivZero
        );
    }

    #[test]
    fn one_based() {
        let mut engine = engine3();
        assert_eq!(
            n(&engine
                .eval_formula("Sheet3", "=SHEET(Sheet1!Z100)")
                .unwrap()),
            1.0
        );
    }

    #[test]
    fn arity_error() {
        let mut engine = engine3();
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEET(A1,B1)").unwrap()),
            CalcError::Value
        );
    }
}
