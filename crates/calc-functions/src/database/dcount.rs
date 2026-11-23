//! `DCOUNT(database, field, criteria)` — counts cells containing
//! numbers in the column `field` of `database`, restricted to rows
//! matching `criteria`. Spec: `docs/functions/DCOUNT.md`.

use crate::common::database;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let sel = match database::select(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    if let Some(e) = sel.field_error() {
        return Ok(Value::Error(e));
    }
    Ok(Value::Number(sel.field_numbers().len() as f64))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_height_apple() {
        assert_eq!(
            n(&eval_with(&db(), r#"=DCOUNT(A1:C5,"Height",E1:E2)"#)),
            2.0
        );
    }

    #[test]
    fn spec_age_and_criteria() {
        assert_eq!(n(&eval_with(&db(), r#"=DCOUNT(A1:C5,"Age",E1:F2)"#)), 1.0);
    }

    #[test]
    fn spec_text_column() {
        assert_eq!(n(&eval_with(&db(), r#"=DCOUNT(A1:C5,"Tree",E1:E2)"#)), 0.0);
    }

    #[test]
    fn spec_no_match() {
        assert_eq!(n(&eval_with(&db(), "=DCOUNT(A1:C5,1,G1:G2)")), 0.0);
    }

    #[test]
    fn field_index() {
        assert_eq!(n(&eval_with(&db(), "=DCOUNT(A1:C5,2,E1:E2)")), 2.0);
    }

    #[test]
    fn counts_only_numbers() {
        let mut i = db();
        // Replace a matched Height with text: count drops to 1.
        i.push(("B5", "x".into()));
        assert_eq!(n(&eval_with(&i, r#"=DCOUNT(A1:C5,"Height",E1:E2)"#)), 1.0);
    }

    #[test]
    fn blank_field_cell_not_counted() {
        let mut i = db();
        i.push(("B5", Value::Blank));
        assert_eq!(n(&eval_with(&i, r#"=DCOUNT(A1:C5,"Height",E1:E2)"#)), 1.0);
    }

    #[test]
    fn bad_field_label() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DCOUNT(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DCOUNT(A1:C5,9,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(
            e(&eval_with(&i, "=DCOUNT(A1:C5,2,H1:H2)")),
            CalcError::Value
        );
    }

    #[test]
    fn or_criteria_rows() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        assert_eq!(n(&eval_with(&i, "=DCOUNT(A1:C5,2,H1:H3)")), 2.0);
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("B2", Value::Error(CalcError::Ref)));
        assert_eq!(
            e(&eval_with(&i, r#"=DCOUNT(A1:C5,"Height",E1:E2)"#)),
            CalcError::Ref
        );
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DCOUNT(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DCOUNT(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
