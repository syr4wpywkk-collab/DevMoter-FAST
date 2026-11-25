//! `DAVERAGE(database, field, criteria)` — arithmetic mean of numeric
//! cells in the column `field` of `database`, restricted to rows
//! matching `criteria`. Spec: `docs/functions/DAVERAGE.md`.

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
    if let Some(e) = sel.field_error() {
        return Ok(Value::Error(e));
    }
    let nums = sel.field_numbers();
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(nums.iter().sum::<f64>() / nums.len() as f64))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_height_apple() {
        assert_eq!(
            n(&eval_with(&db(), r#"=DAVERAGE(A1:C5,"Height",E1:E2)"#)),
            14.0
        );
    }

    #[test]
    fn spec_age_apple() {
        assert_eq!(
            n(&eval_with(&db(), r#"=DAVERAGE(A1:C5,"Age",E1:E2)"#)),
            17.5
        );
    }

    #[test]
    fn spec_no_match_div0() {
        assert_eq!(
            e(&eval_with(&db(), "=DAVERAGE(A1:C5,3,G1:G2)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn spec_bad_field() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DAVERAGE(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn single_match() {
        assert_eq!(n(&eval_with(&db(), "=DAVERAGE(A1:C5,3,E1:F2)")), 20.0);
    }

    #[test]
    fn text_column_div0() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DAVERAGE(A1:C5,"Tree",E1:E2)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn field_index() {
        assert_eq!(n(&eval_with(&db(), "=DAVERAGE(A1:C5,2,E1:E2)")), 14.0);
    }

    #[test]
    fn or_criteria_rows() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        assert_eq!(n(&eval_with(&i, "=DAVERAGE(A1:C5,2,H1:H3)")), 12.5);
    }

    #[test]
    fn numeric_comparison_criterion() {
        let mut i = db();
        i.extend([("H1", "Height".into()), ("H2", ">12".into())]);
        assert_eq!(n(&eval_with(&i, "=DAVERAGE(A1:C5,2,H1:H2)")), 15.5);
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("C2", Value::Error(CalcError::NA)));
        assert_eq!(
            e(&eval_with(&i, r#"=DAVERAGE(A1:C5,"Age",E1:E2)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("C3", Value::Error(CalcError::NA)));
        assert_eq!(n(&eval_with(&i, r#"=DAVERAGE(A1:C5,"Age",E1:E2)"#)), 17.5);
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(
            e(&eval_with(&i, "=DAVERAGE(A1:C5,2,H1:H2)")),
            CalcError::Value
        );
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DAVERAGE(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DAVERAGE(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
