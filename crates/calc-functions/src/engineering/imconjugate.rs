//! `IMCONJUGATE(inumber)` — complex conjugate `x - yi`, as text.
//! The `i`/`j` suffix of the input is preserved in the output
//! (`docs/functions/IMCONJUGATE.md`).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::engineering::imaginary::eval_inumber;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_inumber(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok((z, suffix)) => Ok(Value::Text(z.conj().to_text(suffix))),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
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
        assert_eq!(t(&eval(r#"=IMCONJUGATE("3+4i")"#)), "3-4i");
        assert_eq!(t(&eval(r#"=IMCONJUGATE("3-4i")"#)), "3+4i");
        assert_eq!(t(&eval(r#"=IMCONJUGATE("5")"#)), "5");
        assert_eq!(t(&eval(r#"=IMCONJUGATE("2j")"#)), "-2j");
        assert_eq!(e(&eval(r#"=IMCONJUGATE("xx")"#)), CalcError::Num);
    }

    #[test]
    fn j_suffix_preserved() {
        assert_eq!(t(&eval(r#"=IMCONJUGATE("3+4j")"#)), "3-4j");
    }

    #[test]
    fn unit_imaginary() {
        assert_eq!(t(&eval(r#"=IMCONJUGATE("i")"#)), "-i");
        assert_eq!(t(&eval(r#"=IMCONJUGATE("3-i")"#)), "3+i");
    }

    #[test]
    fn real_number_arg() {
        assert_eq!(t(&eval("=IMCONJUGATE(-2.5)")), "-2.5");
    }

    #[test]
    fn fractional() {
        assert_eq!(t(&eval(r#"=IMCONJUGATE("1.5+2.5i")"#)), "1.5-2.5i");
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMCONJUGATE(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval("=IMCONJUGATE(A1)")), CalcError::Num);
    }

    #[test]
    fn malformed_num() {
        assert_eq!(e(&eval(r#"=IMCONJUGATE("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMCONJUGATE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMCONJUGATE()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMCONJUGATE("1","2")"#)), CalcError::Value);
    }
}
