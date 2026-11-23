//! `ODD(number)` — rounds `number` away from zero to the nearest odd
//! integer. Spec: `docs/functions/ODD.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(Value::Number(odd_away(x)))
}

/// Smallest odd integer `>= |x|` in magnitude, keeping `x`'s sign
/// (`ODD(0)` -> `1`).
fn odd_away(x: f64) -> f64 {
    let mut m = x.abs().ceil();
    if m % 2.0 == 0.0 {
        m += 1.0;
    }
    if x < 0.0 { -m } else { m }
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
    fn spec_examples() {
        assert_eq!(n(&eval("=ODD(1.5)")), 3.0);
        assert_eq!(n(&eval("=ODD(3)")), 3.0);
        assert_eq!(n(&eval("=ODD(2)")), 3.0);
        assert_eq!(n(&eval("=ODD(-1)")), -1.0);
        assert_eq!(n(&eval("=ODD(-2)")), -3.0);
        assert_eq!(n(&eval("=ODD(0)")), 1.0);
    }

    #[test]
    fn negatives_away_from_zero() {
        assert_eq!(n(&eval("=ODD(-1.5)")), -3.0);
        assert_eq!(n(&eval("=ODD(-0.5)")), -1.0);
        assert_eq!(n(&eval("=ODD(-3)")), -3.0);
    }

    #[test]
    fn just_over_odd() {
        assert_eq!(n(&eval("=ODD(3.1)")), 5.0);
        assert_eq!(n(&eval("=ODD(-3.1)")), -5.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=ODD("2.5")"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ODD("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ODD(TRUE)")), 1.0);
        assert_eq!(n(&eval("=ODD(FALSE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_one() {
        // Blank -> 0 -> ODD(0) = 1.
        assert_eq!(n(&eval("=ODD(A1)")), 1.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 4.0.into())], "=ODD(A1)");
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn large_magnitude() {
        assert_eq!(n(&eval("=ODD(1234567890)")), 1234567891.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ODD(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ODD(1,2)")), CalcError::Value);
    }
}
