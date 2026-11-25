//! `DGET(database, field, criteria)` — returns the single `field` cell
//! from the one row of `database` matching `criteria`: zero matches ->
//! `#VALUE!`, more than one -> `#NUM!`.
//! Spec: `docs/functions/DGET.md`.

use crate::common::database;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
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
    match sel.rows.len() {
        0 => Ok(Value::Error(CalcError::Value)),
        1 => {
            if let Some(e) = sel.field_error() {
                return Ok(Value::Error(e));
            }
            Ok(sel.field_cell(0).clone())
        }
        _ => Ok(Value::Error(CalcError::Num)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_single_match() {
        assert_eq!(n(&eval_with(&db(), r#"=DGET(A1:C5,"Age",E1:F2)"#)), 20.0);
    }

    #[test]
    fn spec_two_matches_num() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DGET(A1:C5,"Height",E1:E2)"#)),
            CalcError::Num
        );
    }

    #[test]
    fn spec_no_match_value() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DGET(A1:C5,"Height",G1:G2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn spec_text_extraction() {
        assert_eq!(
            eval_with(&db(), r#"=DGET(A1:C5,"Tree",E1:F2)"#),
            Value::Text("Apple".into())
        );
    }

    #[test]
    fn field_index() {
        assert_eq!(n(&eval_with(&db(), "=DGET(A1:C5,3,E1:F2)")), 20.0);
    }

    #[test]
    fn bad_field_label() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DGET(A1:C5,"Bad",E1:F2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DGET(A1:C5,4,E1:F2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(e(&eval_with(&i, "=DGET(A1:C5,3,H1:H2)")), CalcError::Value);
    }

    #[test]
    fn error_in_matching_cell_propagates() {
        let mut i = db();
        i.push(("C2", Value::Error(CalcError::DivZero)));
        assert_eq!(
            e(&eval_with(&i, r#"=DGET(A1:C5,"Age",E1:F2)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn error_in_non_matching_row_does_not_add_match() {
        // An error in the field column of a non-matching row is ignored.
        let mut i = db();
        i.push(("C3", Value::Error(CalcError::DivZero)));
        assert_eq!(n(&eval_with(&i, r#"=DGET(A1:C5,"Age",E1:F2)"#)), 20.0);
    }

    #[test]
    fn or_criteria_can_yield_num() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        assert_eq!(e(&eval_with(&i, "=DGET(A1:C5,2,H1:H3)")), CalcError::Num);
    }

    #[test]
    fn returns_boolean_cell() {
        let mut i = db();
        i.push(("C2", Value::Boolean(true)));
        assert_eq!(
            eval_with(&i, r#"=DGET(A1:C5,"Age",E1:F2)"#),
            Value::Boolean(true)
        );
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DGET(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DGET(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
