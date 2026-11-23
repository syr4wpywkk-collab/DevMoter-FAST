//! `DSTDEVP(database, field, criteria)` — population standard deviation
//! (n denominator) of numeric cells in the column `field` of
//! `database`, restricted to rows matching `criteria`. Mirrors
//! `STDEV.P`. Spec: `docs/functions/DSTDEVP.md`.

use crate::common::{database, statistics};
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
    match statistics::population_variance(&sel.field_numbers()) {
        Some(v) => Ok(Value::Number(v.sqrt())),
        // Zero numeric cells -> #DIV/0! (documented); single -> 0.
        None => Ok(Value::Error(CalcError::DivZero)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::database::test_support::*;
    use calc_core::{CalcError, Value};

    #[test]
    fn spec_age_apple() {
        assert_eq!(n(&eval_with(&db(), r#"=DSTDEVP(A1:C5,"Age",E1:E2)"#)), 2.5);
    }

    #[test]
    fn spec_single_value_zero() {
        assert_eq!(n(&eval_with(&db(), r#"=DSTDEVP(A1:C5,"Age",E1:F2)"#)), 0.0);
    }

    #[test]
    fn spec_no_match_div0() {
        assert_eq!(
            e(&eval_with(&db(), "=DSTDEVP(A1:C5,2,G1:G2)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn spec_bad_field() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DSTDEVP(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn height_apple() {
        // stdev.p(18,10) = 4
        assert_eq!(
            n(&eval_with(&db(), r#"=DSTDEVP(A1:C5,"Height",E1:E2)"#)),
            4.0
        );
    }

    #[test]
    fn field_index() {
        assert_eq!(n(&eval_with(&db(), "=DSTDEVP(A1:C5,3,E1:E2)")), 2.5);
    }

    #[test]
    fn or_criteria_rows() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        assert_eq!(n(&eval_with(&i, "=DSTDEVP(A1:C5,2,H1:H3)")), 0.5);
    }

    #[test]
    fn text_column_div0() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DSTDEVP(A1:C5,"Tree",E1:E2)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DSTDEVP(A1:C5,4,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(
            e(&eval_with(&i, "=DSTDEVP(A1:C5,2,H1:H2)")),
            CalcError::Value
        );
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("C5", Value::Error(CalcError::NA)));
        assert_eq!(
            e(&eval_with(&i, r#"=DSTDEVP(A1:C5,"Age",E1:E2)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("C3", Value::Error(CalcError::NA)));
        assert_eq!(n(&eval_with(&i, r#"=DSTDEVP(A1:C5,"Age",E1:E2)"#)), 2.5);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DSTDEVP(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DSTDEVP(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
