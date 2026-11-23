//! `DSUM(database, field, criteria)` — sums numeric cells in the column
//! `field` of `database`, restricted to rows matching `criteria`.
//! Spec: `docs/functions/DSUM.md`.

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
    Ok(Value::Number(sel.field_numbers().iter().sum()))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_height_apple() {
        assert_eq!(n(&eval_with(&db(), r#"=DSUM(A1:C5,"Height",E1:E2)"#)), 28.0);
    }

    #[test]
    fn spec_age_apple() {
        assert_eq!(n(&eval_with(&db(), r#"=DSUM(A1:C5,"Age",E1:E2)"#)), 35.0);
    }

    #[test]
    fn spec_no_match() {
        assert_eq!(n(&eval_with(&db(), "=DSUM(A1:C5,2,G1:G2)")), 0.0);
    }

    #[test]
    fn spec_text_column() {
        assert_eq!(n(&eval_with(&db(), r#"=DSUM(A1:C5,"Tree",E1:E2)"#)), 0.0);
    }

    #[test]
    fn and_criteria_single_row() {
        assert_eq!(n(&eval_with(&db(), "=DSUM(A1:C5,3,E1:F2)")), 20.0);
    }

    #[test]
    fn field_index_and_case_insensitive_label() {
        assert_eq!(n(&eval_with(&db(), "=DSUM(A1:C5,2,E1:E2)")), 28.0);
        assert_eq!(n(&eval_with(&db(), r#"=DSUM(A1:C5,"height",E1:E2)"#)), 28.0);
    }

    #[test]
    fn numeric_comparison_criterion() {
        let mut i = db();
        i.extend([("H1", "Height".into()), ("H2", ">12".into())]);
        // Heights > 12: 18 and 13.
        assert_eq!(n(&eval_with(&i, "=DSUM(A1:C5,2,H1:H2)")), 31.0);
    }

    #[test]
    fn or_criteria_rows() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        assert_eq!(n(&eval_with(&i, "=DSUM(A1:C5,2,H1:H3)")), 25.0);
    }

    #[test]
    fn bad_field_label() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DSUM(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DSUM(A1:C5,4,E1:E2)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&db(), "=DSUM(A1:C5,0,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(e(&eval_with(&i, "=DSUM(A1:C5,2,H1:H2)")), CalcError::Value);
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("B2", Value::Error(CalcError::DivZero)));
        assert_eq!(
            e(&eval_with(&i, r#"=DSUM(A1:C5,"Height",E1:E2)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("B3", Value::Error(CalcError::DivZero)));
        assert_eq!(n(&eval_with(&i, r#"=DSUM(A1:C5,"Height",E1:E2)"#)), 28.0);
    }

    #[test]
    fn blank_criteria_cell_is_no_constraint() {
        let mut i = db();
        // F2 blank: only the Tree=Apple term applies.
        i.push(("F2", Value::Blank));
        assert_eq!(n(&eval_with(&i, "=DSUM(A1:C5,2,E1:F2)")), 28.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DSUM(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DSUM(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
