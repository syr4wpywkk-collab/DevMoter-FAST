//! `LOOKUP(lookup_value, lookup_vector, [result_vector])` — vector form;
//! `LOOKUP(lookup_value, array)` — array form.
//! Spec: `docs/functions/LOOKUP.md`.
//!
//! Always approximate: the largest element `<= lookup_value` under the
//! *ascending-sort assumption* (binary search — deterministic but
//! unspecified on unsorted input, SPEC-OPEN). No wildcard support.
//!
//! Array form orientation: wider-than-tall searches the first row and
//! returns the last row; tall or square searches the first column and
//! returns the last column (SPEC-OPEN: square case is documented as
//! column-oriented pending empirical confirmation).

use crate::common::lookup;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let needle = ctx.eval(&args[0])?;
    if let Some(e) = needle.error() {
        return Ok(Value::Error(e));
    }
    let search = match matrix(ctx, &args[1])? {
        Ok(m) => m,
        Err(v) => return Ok(v),
    };
    match args.get(2) {
        None => Ok(array_form(&search, &needle)),
        Some(Expr::Missing) => Ok(array_form(&search, &needle)),
        Some(expr) => {
            let result = match matrix(ctx, expr)? {
                Ok(m) => m,
                Err(v) => return Ok(v),
            };
            Ok(vector_form(&search, &result, &needle))
        }
    }
}

fn matrix(ctx: &mut EvalContext<'_>, expr: &Expr) -> Result<Result<ArrayValue, Value>, EvalError> {
    match ctx.eval_arg(expr)? {
        ArgValue::Range(a) | ArgValue::Scalar(Value::Array(a)) => Ok(Ok(a)),
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => {
            Ok(Err(Value::Error(e)))
        }
        ArgValue::Ref(v) => Ok(Ok(ArrayValue::new(1, 1, vec![v]).expect("1x1"))),
        ArgValue::Scalar(_) => Ok(Err(Value::Error(CalcError::Value))),
    }
}

/// Vector form: `lookup_vector` must be 1-D; `result_vector` must match
/// its size and shape (mismatch -> `#N/A`, per spec doc).
fn vector_form(search: &ArrayValue, result: &ArrayValue, needle: &Value) -> Value {
    if result.rows() != search.rows() || result.cols() != search.cols() {
        return lookup::not_found();
    }
    let (keys, vals): (Vec<Value>, Vec<Value>) = if search.cols() == 1 {
        (
            (0..search.rows())
                .map(|r| search.get(r, 0).unwrap().clone())
                .collect(),
            (0..result.rows())
                .map(|r| result.get(r, 0).unwrap().clone())
                .collect(),
        )
    } else if search.rows() == 1 {
        (
            (0..search.cols())
                .map(|c| search.get(0, c).unwrap().clone())
                .collect(),
            (0..result.cols())
                .map(|c| result.get(0, c).unwrap().clone())
                .collect(),
        )
    } else {
        return Value::Error(CalcError::Value); // 2-D lookup_vector
    };
    match lookup::approx_asc(&keys, needle) {
        Some(i) => vals[i].clone(),
        None => lookup::not_found(),
    }
}

/// Array form: wider-than-tall searches the first row / returns the
/// last row; tall-or-square searches the first column / last column.
fn array_form(a: &ArrayValue, needle: &Value) -> Value {
    if a.cols() > a.rows() {
        let keys: Vec<Value> = (0..a.cols())
            .map(|c| a.get(0, c).unwrap().clone())
            .collect();
        match lookup::approx_asc(&keys, needle) {
            Some(c) => a.get(a.rows() - 1, c as u32).unwrap().clone(),
            None => lookup::not_found(),
        }
    } else {
        let keys: Vec<Value> = (0..a.rows())
            .map(|r| a.get(r, 0).unwrap().clone())
            .collect();
        match lookup::approx_asc(&keys, needle) {
            Some(r) => a.get(r as u32, a.cols() - 1).unwrap().clone(),
            None => lookup::not_found(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

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

    fn nums() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
        ]
    }

    #[test]
    fn vector_form() {
        let mut inputs = nums();
        inputs.extend([
            ("B1", "a".into()),
            ("B2", "b".into()),
            ("B3", "c".into()),
            ("B4", "d".into()),
        ]);
        let v = eval_with(&inputs, "=LOOKUP(2.5,A1:A4,B1:B4)");
        assert_eq!(v, Value::Text("b".into()));
    }

    #[test]
    fn vector_form_exact_hit() {
        let mut inputs = nums();
        inputs.extend([
            ("B1", "a".into()),
            ("B2", "b".into()),
            ("B3", "c".into()),
            ("B4", "d".into()),
        ]);
        let v = eval_with(&inputs, "=LOOKUP(3,A1:A4,B1:B4)");
        assert_eq!(v, Value::Text("c".into()));
    }

    #[test]
    fn vector_form_below_all() {
        let mut inputs = nums();
        inputs.extend([
            ("B1", "a".into()),
            ("B2", "b".into()),
            ("B3", "c".into()),
            ("B4", "d".into()),
        ]);
        assert_eq!(
            e(&eval_with(&inputs, "=LOOKUP(0,A1:A4,B1:B4)")),
            CalcError::NA
        );
    }

    #[test]
    fn vector_form_size_mismatch() {
        let mut inputs = nums();
        inputs.extend([("B1", "a".into()), ("B2", "b".into())]);
        assert_eq!(
            e(&eval_with(&inputs, "=LOOKUP(2,A1:A4,B1:B2)")),
            CalcError::NA
        );
    }

    #[test]
    fn array_form_tall() {
        // 4x2 tall: search first column, return last column.
        let mut inputs = nums();
        inputs.extend([
            ("B1", 10.0.into()),
            ("B2", 20.0.into()),
            ("B3", 30.0.into()),
            ("B4", 40.0.into()),
        ]);
        assert_eq!(n(&eval_with(&inputs, "=LOOKUP(2.5,A1:B4)")), 20.0);
    }

    #[test]
    fn array_form_wide() {
        // 2x4 wide: search first row, return last row.
        let inputs = vec![
            ("A1", 1.0.into()),
            ("B1", 2.0.into()),
            ("C1", 3.0.into()),
            ("D1", 4.0.into()),
            ("A2", 10.0.into()),
            ("B2", 20.0.into()),
            ("C2", 30.0.into()),
            ("D2", 40.0.into()),
        ];
        assert_eq!(n(&eval_with(&inputs, "=LOOKUP(2.5,A1:D2)")), 20.0);
    }

    #[test]
    fn array_form_square_uses_column() {
        // Square: column search (documented SPEC-OPEN orientation).
        let inputs = vec![
            ("A1", 1.0.into()),
            ("B1", 100.0.into()),
            ("A2", 2.0.into()),
            ("B2", 200.0.into()),
        ];
        assert_eq!(n(&eval_with(&inputs, "=LOOKUP(1.5,A1:B2)")), 100.0);
    }

    #[test]
    fn text_lookup_case_insensitive() {
        let inputs = vec![
            ("A1", "apple".into()),
            ("A2", "banana".into()),
            ("B1", 1.0.into()),
            ("B2", 2.0.into()),
        ];
        assert_eq!(
            n(&eval_with(&inputs, r#"=LOOKUP("BANANA",A1:A2,B1:B2)"#)),
            2.0
        );
    }

    #[test]
    fn error_needle_propagates() {
        assert_eq!(
            e(&eval_with(&nums(), "=LOOKUP(1/0,A1:A4)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn row_vector_form() {
        let inputs = vec![
            ("A1", 1.0.into()),
            ("B1", 2.0.into()),
            ("C1", 3.0.into()),
            ("A2", "a".into()),
            ("B2", "b".into()),
            ("C2", "c".into()),
        ];
        let v = eval_with(&inputs, "=LOOKUP(2.5,A1:C1,A2:C2)");
        assert_eq!(v, Value::Text("b".into()));
    }

    #[test]
    fn above_all_returns_last() {
        let mut inputs = nums();
        inputs.extend([
            ("B1", "a".into()),
            ("B2", "b".into()),
            ("B3", "c".into()),
            ("B4", "d".into()),
        ]);
        let v = eval_with(&inputs, "=LOOKUP(99,A1:A4,B1:B4)");
        assert_eq!(v, Value::Text("d".into()));
    }
}
