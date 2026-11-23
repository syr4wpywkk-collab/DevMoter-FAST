//! `DMIN(database, field, criteria)` — smallest numeric value in the
//! column `field` of `database`, restricted to rows matching
//! `criteria`. Spec: `docs/functions/DMIN.md`.

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
    let min = sel
        .field_numbers()
        .into_iter()
        .fold(f64::INFINITY, f64::min);
    // Empty matching set / no numeric cells -> 0 (documented).
    Ok(Value::Number(if min.is_finite() { min } else { 0.0 }))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_height_apple() {
        assert_eq!(n(&eval_with(&db(), r#"=DMIN(A1:C5,"Height",E1:E2)"#)), 10.0);
    }

    #[test]
    fn spec_age_and_criteria() {
        assert_eq!(n(&eval_with(&db(), r#"=DMIN(A1:C5,"Age",E1:F2)"#)), 20.0);
    }

    #[test]
    fn spec_no_match() {
        assert_eq!(n(&eval_with(&db(), "=DMIN(A1:C5,2,G1:G2)")), 0.0);
    }

    #[test]
    fn spec_bad_field() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DMIN(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn text_column_zero() {
        assert_eq!(n(&eval_with(&db(), r#"=DMIN(A1:C5,"Tree",E1:E2)"#)), 0.0);
    }

    #[test]
    fn negative_values() {
        let mut i = db();
        i.extend([("B2", (-5.0).into()), ("B5", (-2.0).into())]);
        assert_eq!(n(&eval_with(&i, r#"=DMIN(A1:C5,"Height",E1:E2)"#)), -5.0);
    }

    #[test]
    fn field_index() {
        assert_eq!(n(&eval_with(&db(), "=DMIN(A1:C5,2,E1:E2)")), 10.0);
    }

    #[test]
    fn or_criteria_rows() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        assert_eq!(n(&eval_with(&i, "=DMIN(A1:C5,2,H1:H3)")), 12.0);
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DMIN(A1:C5,4,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(e(&eval_with(&i, "=DMIN(A1:C5,2,H1:H2)")), CalcError::Value);
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("B5", Value::Error(CalcError::Ref)));
        assert_eq!(
            e(&eval_with(&i, r#"=DMIN(A1:C5,"Height",E1:E2)"#)),
            CalcError::Ref
        );
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("B3", Value::Error(CalcError::Ref)));
        assert_eq!(n(&eval_with(&i, r#"=DMIN(A1:C5,"Height",E1:E2)"#)), 10.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DMIN(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DMIN(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
