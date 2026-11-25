//! `DCOUNTA(database, field, criteria)` — counts non-blank cells in the
//! column `field` of `database`, restricted to rows matching
//! `criteria`. Spec: `docs/functions/DCOUNTA.md`.

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
    let count = sel.field_cells().filter(|v| !v.is_blank()).count();
    Ok(Value::Number(count as f64))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_tree_apple() {
        assert_eq!(n(&eval_with(&db(), r#"=DCOUNTA(A1:C5,"Tree",E1:E2)"#)), 2.0);
    }

    #[test]
    fn spec_and_criteria() {
        assert_eq!(
            n(&eval_with(&db(), r#"=DCOUNTA(A1:C5,"Height",E1:F2)"#)),
            1.0
        );
    }

    #[test]
    fn spec_no_match() {
        assert_eq!(n(&eval_with(&db(), "=DCOUNTA(A1:C5,2,G1:G2)")), 0.0);
    }

    #[test]
    fn spec_bad_field() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DCOUNTA(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn counts_text() {
        // Unlike DCOUNT, text cells count.
        assert_eq!(n(&eval_with(&db(), "=DCOUNTA(A1:C5,1,E1:E2)")), 2.0);
    }

    #[test]
    fn blank_field_cell_not_counted() {
        let mut i = db();
        i.push(("A5", Value::Blank));
        assert_eq!(n(&eval_with(&i, "=DCOUNTA(A1:C5,1,G1:G2)")), 0.0);
        i.push(("G2", "Apple".into()));
        // A2 "Apple" and blank A5 now match Tree=Apple -> 1 non-blank.
        assert_eq!(n(&eval_with(&i, "=DCOUNTA(A1:C5,1,G1:G2)")), 1.0);
    }

    #[test]
    fn empty_string_counts() {
        // An empty-string field cell counts (only true blanks don't).
        // Height<11 matches only row 5, whose Tree cell is "" -> 1.
        let mut i = db();
        i.extend([
            ("A5", "".into()),
            ("H1", "Height".into()),
            ("H2", "<11".into()),
        ]);
        assert_eq!(n(&eval_with(&i, "=DCOUNTA(A1:C5,1,H1:H2)")), 1.0);
        i.push(("A5", Value::Blank));
        assert_eq!(n(&eval_with(&i, "=DCOUNTA(A1:C5,1,H1:H2)")), 0.0);
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DCOUNTA(A1:C5,0,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(
            e(&eval_with(&i, "=DCOUNTA(A1:C5,2,H1:H2)")),
            CalcError::Value
        );
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("B2", Value::Error(CalcError::Num)));
        assert_eq!(e(&eval_with(&i, "=DCOUNTA(A1:C5,2,E1:E2)")), CalcError::Num);
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("A3", Value::Error(CalcError::Num)));
        assert_eq!(n(&eval_with(&i, "=DCOUNTA(A1:C5,1,E1:E2)")), 2.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DCOUNTA(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DCOUNTA(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
