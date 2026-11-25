//! `N(value)` — converts `value` to a number under Excel's fixed
//! conversion table: numbers pass through, `TRUE`/`FALSE` -> 1/0, ALL
//! text (including `"5"`) -> 0, blank -> 0, errors propagate.
//! `N` is not `VALUE` — no numeric parsing of text. Array arguments
//! convert element-wise. Spec: `docs/functions/N.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn convert(v: &Value) -> Value {
    match v {
        Value::Number(n) => Value::Number(*n),
        Value::Boolean(b) => Value::Number(if *b { 1.0 } else { 0.0 }),
        Value::Text(_) | Value::Blank => Value::Number(0.0),
        Value::Error(e) => Value::Error(*e),
        // Lambda/Reference values have no numeric conversion (`#VALUE!`,
        // unconfirmed for Lambda — spec open question).
        _ => Value::Error(calc_core::error::CalcError::Value),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval_arg(&args[0])?.into_value();
    if let Value::Array(a) = v {
        let mut cells = Vec::with_capacity(a.len());
        for cell in a.iter() {
            let c = convert(cell);
            if c.is_error() {
                return Ok(c);
            }
            cells.push(c);
        }
        return match calc_core::array::ArrayValue::new(a.rows(), a.cols(), cells) {
            Ok(arr) => Ok(Value::Array(arr)),
            Err(e) => Ok(Value::Error(e)),
        };
    }
    Ok(convert(&v))
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

    #[test]
    fn number_unchanged() {
        assert_eq!(n(&eval("=N(3.5)")), 3.5);
        assert_eq!(n(&eval("=N(-10)")), -10.0);
        assert_eq!(n(&eval("=N(0)")), 0.0);
    }

    #[test]
    fn booleans() {
        assert_eq!(n(&eval("=N(TRUE)")), 1.0);
        assert_eq!(n(&eval("=N(FALSE)")), 0.0);
    }

    #[test]
    fn text_is_zero() {
        assert_eq!(n(&eval(r#"=N("17")"#)), 0.0);
        assert_eq!(n(&eval(r#"=N("abc")"#)), 0.0);
        assert_eq!(n(&eval(r#"=N("")"#)), 0.0);
    }

    #[test]
    fn blank_cell_zero() {
        assert_eq!(n(&eval("=N(A1)")), 0.0);
    }

    #[test]
    fn text_cell_zero() {
        assert_eq!(n(&eval_with(&[("A1", "5".into())], "=N(A1)")), 0.0);
    }

    #[test]
    fn bool_cell() {
        assert_eq!(
            n(&eval_with(&[("A1", Value::Boolean(true))], "=N(A1)")),
            1.0
        );
    }

    #[test]
    fn date_serial() {
        // Dates are numbers: DATE(2020,1,1) = 43831 in the 1900 system.
        assert_eq!(n(&eval("=N(DATE(2020,1,1))")), 43831.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=N(NA())")), CalcError::NA);
        assert_eq!(e(&eval("=N(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn range_converts_elementwise() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("B1", Value::Boolean(true)),
                ("A2", "x".into()),
                // B2 left blank
            ],
            "=N(A1:B2)",
        );
        match v {
            Value::Array(a) => {
                assert_eq!(a.get(0, 0), Some(&Value::Number(2.0)));
                assert_eq!(a.get(0, 1), Some(&Value::Number(1.0)));
                assert_eq!(a.get(1, 0), Some(&Value::Number(0.0)));
                assert_eq!(a.get(1, 1), Some(&Value::Number(0.0)));
            }
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn n_is_not_value() {
        assert_eq!(n(&eval(r#"=N("5")"#)), 0.0);
        assert_eq!(n(&eval(r#"=VALUE("5")"#)), 5.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=N()")), CalcError::Value);
        assert_eq!(e(&eval("=N(1,2)")), CalcError::Value);
    }
}
