//! `IMREAL(inumber)` — real coefficient of a complex number stored as
//! text. Returns a `Number`. Spec: `docs/functions/IMREAL.md`.
//! Parsing owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::scalar_operand;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match scalar_operand(&ctx.eval(&args[0])?) {
        Err(e) => Ok(Value::Error(e)),
        Ok(z) => Ok(Value::Number(z.re)),
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

    #[test]
    fn spec_examples() {
        assert_eq!(n(&eval(r#"=IMREAL("6-9i")"#)), 6.0);
        assert_eq!(n(&eval(r#"=IMREAL("3+4j")"#)), 3.0);
        assert_eq!(n(&eval(r#"=IMREAL("-4i")"#)), 0.0);
        assert_eq!(n(&eval("=IMREAL(12.5)")), 12.5);
        assert_eq!(e(&eval(r#"=IMREAL("n/a")"#)), CalcError::Num);
    }

    #[test]
    fn pure_imaginary_zero() {
        assert_eq!(n(&eval(r#"=IMREAL("i")"#)), 0.0);
        assert_eq!(n(&eval(r#"=IMREAL("-j")"#)), 0.0);
    }

    #[test]
    fn negative_real() {
        assert_eq!(n(&eval(r#"=IMREAL("-2.5-3i")"#)), -2.5);
    }

    #[test]
    fn text_real() {
        assert_eq!(n(&eval(r#"=IMREAL("7")"#)), 7.0);
    }

    #[test]
    fn scientific_coefficient() {
        assert_eq!(n(&eval(r#"=IMREAL("1e2+3i")"#)), 100.0);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMREAL(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_zero() {
        // SPEC-OPEN per spec: blank treated as 0+0i.
        assert_eq!(n(&eval("=IMREAL(A1)")), 0.0);
    }

    #[test]
    fn cell_ref_text() {
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Text("6-9i".into()))],
                "=IMREAL(A1)"
            )),
            6.0
        );
    }

    #[test]
    fn uppercase_suffix_num() {
        assert_eq!(e(&eval(r#"=IMREAL("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMREAL(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMREAL()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMREAL("1","2")"#)), CalcError::Value);
    }
}
