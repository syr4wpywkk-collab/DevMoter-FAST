//! `DMAX(database, field, criteria)` — largest numeric value in the
//! column `field` of `database`, restricted to rows matching
//! `criteria`. Spec: `docs/functions/DMAX.md`.

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
    let max = sel
        .field_numbers()
        .into_iter()
        .fold(f64::NEG_INFINITY, f64::max);
    // Empty matching set / no numeric cells -> 0 (documented).
    Ok(Value::Number(if max.is_finite() { max } else { 0.0 }))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_height_apple() {
        assert_eq!(n(&eval_with(&db(), r#"=DMAX(A1:C5,"Height",E1:E2)"#)), 18.0);
    }

    #[test]
    fn spec_age_and_criteria() {
        assert_eq!(n(&eval_with(&db(), r#"=DMAX(A1:C5,"Age",E1:F2)"#)), 20.0);
    }

    #[test]
    fn spec_no_match() {
        assert_eq!(n(&eval_with(&db(), "=DMAX(A1:C5,2,G1:G2)")), 0.0);
    }

    #[test]
    fn spec_text_column() {
        assert_eq!(n(&eval_with(&db(), r#"=DMAX(A1:C5,"Tree",E1:E2)"#)), 0.0);
    }

    #[test]
    fn negative_values() {
        let mut i = db();
        i.extend([("B2", (-5.0).into()), ("B5", (-2.0).into())]);
        assert_eq!(n(&eval_with(&i, r#"=DMAX(A1:C5,"Height",E1:E2)"#)), -2.0);
    }

    #[test]
    fn field_index() {
        assert_eq!(n(&eval_with(&db(), "=DMAX(A1:C5,2,E1:E2)")), 18.0);
    }

    #[test]
    fn numeric_comparison_criterion() {
        let mut i = db();
        i.extend([("H1", "Height".into()), ("H2", ">12".into())]);
        assert_eq!(n(&eval_with(&i, "=DMAX(A1:C5,2,H1:H2)")), 18.0);
    }

    #[test]
    fn bad_field_label() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DMAX(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DMAX(A1:C5,0,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(e(&eval_with(&i, "=DMAX(A1:C5,2,H1:H2)")), CalcError::Value);
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("B5", Value::Error(CalcError::NA)));
        assert_eq!(
            e(&eval_with(&i, r#"=DMAX(A1:C5,"Height",E1:E2)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("B3", Value::Error(CalcError::NA)));
        assert_eq!(n(&eval_with(&i, r#"=DMAX(A1:C5,"Height",E1:E2)"#)), 18.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DMAX(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DMAX(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
