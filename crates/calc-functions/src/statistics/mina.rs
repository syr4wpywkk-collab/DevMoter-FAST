//! `MINA(value1, [value2], ...)` — minimum counting `TRUE` as `1` and
//! `FALSE`/text/blank as `0` inside ranges. Spec: `docs/functions/MINA.md`.

use crate::common::coercion;
use crate::statistics::maxa::a_rule_number;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let flat = coercion::flatten_args(ctx, args)?;
    let mut best: Option<f64> = None;
    for (v, ranged) in flat {
        let x = match a_rule_number(&v, ranged) {
            Err(e) => return Ok(Value::Error(e)),
            Ok(x) => x,
        };
        best = Some(best.map_or(x, |b: f64| b.min(x)));
    }
    Ok(Value::Number(best.unwrap_or(0.0)))
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
    fn basic_min() {
        assert_eq!(n(&eval("=MINA(4,7,5)")), 4.0);
    }

    #[test]
    fn negative_set() {
        assert_eq!(n(&eval("=MINA(-5,-3)")), -5.0);
    }

    #[test]
    fn range_false_text_zero() {
        // FALSE (0), 0.5, "x" (0) -> min 0.
        let v = eval_with(
            &[
                ("A1", Value::Boolean(false)),
                ("A2", 0.5.into()),
                ("A3", "x".into()),
            ],
            "=MINA(A1:A3)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn range_true_counts_one() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", 3.0.into()),
                ("A3", 5.0.into()),
            ],
            "=MINA(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn all_blank_range_zero() {
        assert_eq!(n(&eval("=MINA(A1:A2)")), 0.0);
    }

    #[test]
    fn negative_beats_blank_zero() {
        let v = eval_with(&[("A1", (-5.0).into())], "=MINA(A1:A2)");
        assert_eq!(n(&v), -5.0);
    }

    #[test]
    fn scalar_numeric_text_coerces() {
        assert_eq!(n(&eval("=MINA(\"3\",8)")), 3.0);
    }

    #[test]
    fn scalar_boolean_coerces() {
        assert_eq!(n(&eval("=MINA(TRUE,5)")), 1.0);
    }

    #[test]
    fn scalar_text_value_error() {
        assert_eq!(e(&eval("=MINA(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MINA(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn multiple_args() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 7.0.into())],
            "=MINA(9,A1:A2,5)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=MINA()")), CalcError::Value);
    }
}
