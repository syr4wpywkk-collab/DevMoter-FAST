//! `SHEETS([reference])` — number of worksheets in the workbook when
//! the argument is omitted, or spanned by the reference (1 for any
//! ordinary reference; 3-D sheet-span references such as
//! `Sheet1:Sheet3!A1` are not parsed by the engine — SPEC-OPEN).
//! Spec: `docs/functions/SHEETS.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 1) {
        return Ok(Value::Error(e));
    }
    match args.first() {
        None | Some(Expr::Missing) => Ok(Value::Number(ctx.sheet_count() as f64)),
        Some(expr) => match ctx.eval_ref(expr)? {
            // A single rectangular reference spans exactly one sheet.
            Ok(_) => Ok(Value::Number(1.0)),
            Err(e) => Ok(Value::Error(e)),
        },
    }
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

    fn engine_n(count: usize) -> CalcEngine {
        let mut engine = CalcEngine::new();
        engine.set_registry(Box::new(crate::registry::default_registry()));
        for i in 1..=count {
            engine.add_sheet(&format!("Sheet{i}")).unwrap();
        }
        engine
    }

    #[test]
    fn counts_all_sheets() {
        let mut engine = engine_n(3);
        assert_eq!(n(&engine.eval_formula("Sheet1", "=SHEETS()").unwrap()), 3.0);
    }

    #[test]
    fn single_sheet_book() {
        let mut engine = engine_n(1);
        assert_eq!(n(&engine.eval_formula("Sheet1", "=SHEETS()").unwrap()), 1.0);
    }

    #[test]
    fn larger_book() {
        let mut engine = engine_n(5);
        assert_eq!(n(&engine.eval_formula("Sheet4", "=SHEETS()").unwrap()), 5.0);
    }

    #[test]
    fn same_from_any_sheet() {
        let mut engine = engine_n(3);
        assert_eq!(n(&engine.eval_formula("Sheet3", "=SHEETS()").unwrap()), 3.0);
    }

    #[test]
    fn normal_reference_spans_one() {
        let mut engine = engine_n(3);
        assert_eq!(
            n(&engine.eval_formula("Sheet1", "=SHEETS(Sheet2!B4)").unwrap()),
            1.0
        );
        assert_eq!(
            n(&engine.eval_formula("Sheet1", "=SHEETS(A1:C3)").unwrap()),
            1.0
        );
    }

    #[test]
    fn missing_sheet_ref() {
        let mut engine = engine_n(2);
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEETS(Nosuch!A1)").unwrap()),
            CalcError::Ref
        );
    }

    #[test]
    fn non_ref_scalar() {
        let mut engine = engine_n(2);
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEETS(3)").unwrap()),
            CalcError::Value
        );
        assert_eq!(
            e(&engine
                .eval_formula("Sheet1", r#"=SHEETS("Sheet1")"#)
                .unwrap()),
            CalcError::Value
        );
    }

    #[test]
    fn error_arg_propagates() {
        let mut engine = engine_n(1);
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEETS(NA())").unwrap()),
            CalcError::NA
        );
    }

    #[test]
    fn paired_with_sheet() {
        // SHEET() <= SHEETS() for any calling sheet.
        let mut engine = engine_n(3);
        assert!(b(&engine
            .eval_formula("Sheet2", "=SHEET()<=SHEETS()")
            .unwrap()));
    }

    fn b(v: &Value) -> bool {
        matches!(v, Value::Boolean(true))
    }

    #[test]
    fn arity_error() {
        let mut engine = engine_n(1);
        assert_eq!(
            e(&engine.eval_formula("Sheet1", "=SHEETS(A1,B1)").unwrap()),
            CalcError::Value
        );
    }
}
