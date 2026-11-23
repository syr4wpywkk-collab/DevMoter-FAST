//! `MAXA(value1, [value2], ...)` — maximum counting `TRUE` as `1` and
//! `FALSE`/text/blank as `0` inside ranges. Spec: `docs/functions/MAXA.md`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

/// One member's numeric contribution under the `*A` rule:
/// ranged members map `TRUE`->1 and everything non-numeric else ->0;
/// scalars coerce via `to_number` (numeric text counts, other text
/// errors — the non-numeric-direct-text case is SPEC-OPEN in MAXA.md).
pub(crate) fn a_rule_number(v: &Value, ranged: bool) -> Result<f64, calc_core::error::CalcError> {
    if let Some(e) = v.error() {
        return Err(e);
    }
    if !ranged {
        return v.to_number();
    }
    Ok(match v {
        Value::Number(n) => *n,
        Value::Boolean(true) => 1.0,
        _ => 0.0,
    })
}

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
        best = Some(best.map_or(x, |b: f64| b.max(x)));
    }
    // `flat` is non-empty (arity >= 1 arg -> at least one member).
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
    fn basic_max() {
        assert_eq!(n(&eval("=MAXA(1,3,2)")), 3.0);
    }

    #[test]
    fn negative_set() {
        assert_eq!(n(&eval("=MAXA(-5,-3)")), -3.0);
    }

    #[test]
    fn range_true_counts_one() {
        // A1=TRUE (1), A3 text (0), A2=0.1 -> max 1.
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", 0.1.into()),
                ("A3", "x".into()),
            ],
            "=MAXA(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn range_false_text_blank_zero() {
        let v = eval_with(
            &[("A1", Value::Boolean(false)), ("A2", "x".into())],
            "=MAXA(A1:A3)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn all_blank_range_zero() {
        assert_eq!(n(&eval("=MAXA(A1:A3)")), 0.0);
    }

    #[test]
    fn negative_beats_zero_member() {
        // Only -5 plus a text cell (0) -> 0 wins over -5.
        let v = eval_with(&[("A1", (-5.0).into()), ("A2", "x".into())], "=MAXA(A1:A2)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn scalar_numeric_text_coerces() {
        assert_eq!(n(&eval("=MAXA(\"3\",2)")), 3.0);
    }

    #[test]
    fn scalar_boolean_coerces() {
        assert_eq!(n(&eval("=MAXA(TRUE,-5)")), 1.0);
        assert_eq!(n(&eval("=MAXA(FALSE,-5)")), 0.0);
    }

    #[test]
    fn scalar_text_value_error() {
        // SPEC-OPEN in spec; implemented per MAX direct-arg rules.
        assert_eq!(e(&eval("=MAXA(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=MAXA(A1:B2,1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn multiple_args() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 7.0.into())],
            "=MAXA(1,A1:A2,5)",
        );
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=MAXA()")), CalcError::Value);
    }
}
