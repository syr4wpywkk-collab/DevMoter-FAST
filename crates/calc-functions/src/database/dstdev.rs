//! `DSTDEV(database, field, criteria)` — sample standard deviation
//! (n-1 denominator) of numeric cells in the column `field` of
//! `database`, restricted to rows matching `criteria`. Mirrors
//! `STDEV.S`. Spec: `docs/functions/DSTDEV.md`.

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
    match statistics::sample_variance(&sel.field_numbers()) {
        Some(v) => Ok(Value::Number(v.sqrt())),
        // Fewer than 2 numeric cells -> #DIV/0! (documented).
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
        let v = eval_with(&db(), r#"=DSTDEV(A1:C5,"Age",E1:E2)"#);
        assert!((n(&v) - 3.53553390593274).abs() < 1e-12);
    }

    #[test]
    fn spec_single_value_div0() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DSTDEV(A1:C5,"Age",E1:F2)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn spec_no_match_div0() {
        assert_eq!(
            e(&eval_with(&db(), "=DSTDEV(A1:C5,2,G1:G2)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn spec_bad_field() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DSTDEV(A1:C5,"Bad",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn height_apple() {
        // stdev.s(18,10) = sqrt(32)
        let v = eval_with(&db(), r#"=DSTDEV(A1:C5,"Height",E1:E2)"#);
        assert!((n(&v) - 32f64.sqrt()).abs() < 1e-12);
    }

    #[test]
    fn field_index() {
        let v = eval_with(&db(), "=DSTDEV(A1:C5,3,E1:E2)");
        assert!((n(&v) - 3.53553390593274).abs() < 1e-12);
    }

    #[test]
    fn or_criteria_rows() {
        let mut i = db();
        i.extend([
            ("H1", "Tree".into()),
            ("H2", "Pear".into()),
            ("H3", "Cherry".into()),
        ]);
        // stdev.s(12,13) = sqrt(0.5)
        let v = eval_with(&i, "=DSTDEV(A1:C5,2,H1:H3)");
        assert!((n(&v) - 0.5f64.sqrt()).abs() < 1e-12);
    }

    #[test]
    fn text_column_div0() {
        assert_eq!(
            e(&eval_with(&db(), r#"=DSTDEV(A1:C5,"Tree",E1:E2)"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn bad_field_index() {
        assert_eq!(
            e(&eval_with(&db(), "=DSTDEV(A1:C5,0,E1:E2)")),
            CalcError::Value
        );
    }

    #[test]
    fn unmatched_criteria_header() {
        let mut i = db();
        i.extend([("H1", "Nope".into()), ("H2", "Apple".into())]);
        assert_eq!(
            e(&eval_with(&i, "=DSTDEV(A1:C5,2,H1:H2)")),
            CalcError::Value
        );
    }

    #[test]
    fn error_in_matching_field_cell_propagates() {
        let mut i = db();
        i.push(("C2", Value::Error(CalcError::Value)));
        assert_eq!(
            e(&eval_with(&i, r#"=DSTDEV(A1:C5,"Age",E1:E2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_in_non_matching_field_cell_ignored() {
        let mut i = db();
        i.push(("C3", Value::Error(CalcError::Value)));
        let v = eval_with(&i, r#"=DSTDEV(A1:C5,"Age",E1:E2)"#);
        assert!((n(&v) - 3.53553390593274).abs() < 1e-12);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=DSTDEV(A1:C5,2)")), CalcError::Value);
        assert_eq!(e(&eval("=DSTDEV(A1:C5,2,E1:E2,3)")), CalcError::Value);
    }
}
