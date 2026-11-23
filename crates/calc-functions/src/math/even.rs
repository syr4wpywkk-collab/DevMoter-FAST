//! `EVEN(number)` — rounds `number` away from zero to the nearest even
//! integer. Spec: `docs/functions/EVEN.md`.

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
    Ok(Value::Number(even_away(x)))
}

/// Smallest even integer `>= |x|` in magnitude, keeping `x`'s sign.
fn even_away(x: f64) -> f64 {
    if x == 0.0 {
        return 0.0;
    }
    let mut m = x.abs().ceil();
    if m % 2.0 != 0.0 {
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
        assert_eq!(n(&eval("=EVEN(1.5)")), 2.0);
        assert_eq!(n(&eval("=EVEN(3)")), 4.0);
        assert_eq!(n(&eval("=EVEN(-1)")), -2.0);
        assert_eq!(n(&eval("=EVEN(0.23)")), 2.0);
    }

    #[test]
    fn already_even() {
        assert_eq!(n(&eval("=EVEN(2)")), 2.0);
        assert_eq!(n(&eval("=EVEN(-4)")), -4.0);
        assert_eq!(n(&eval("=EVEN(0)")), 0.0);
    }

    #[test]
    fn negatives_away_from_zero() {
        assert_eq!(n(&eval("=EVEN(-2.5)")), -4.0);
        assert_eq!(n(&eval("=EVEN(-0.5)")), -2.0);
    }

    #[test]
    fn just_over_even() {
        assert_eq!(n(&eval("=EVEN(2.1)")), 4.0);
        assert_eq!(n(&eval("=EVEN(-2.1)")), -4.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=EVEN("1.5")"#)), 2.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=EVEN("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=EVEN(TRUE)")), 2.0);
        assert_eq!(n(&eval("=EVEN(FALSE)")), 0.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=EVEN(A1)")), 0.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 3.0.into())], "=EVEN(A1)");
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=EVEN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=EVEN(1,2)")), CalcError::Value);
    }
}
