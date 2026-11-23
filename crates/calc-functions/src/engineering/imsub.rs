//! `IMSUB(inumber1, inumber2)` — difference of two complex numbers, as
//! text: `(a+bi) − (c+di) = (a−c) + (b−d)i`.
//! Spec: `docs/functions/IMSUB.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::scalar_operand;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let a = match scalar_operand(&ctx.eval(&args[0])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    let b = match scalar_operand(&ctx.eval(&args[1])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    Ok(Value::Text((a - b).to_text('i')))
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
        assert_eq!(t(&eval(r#"=IMSUB("13+4i","5+3i")"#)), "8+i");
        assert_eq!(t(&eval(r#"=IMSUB("13","5+3i")"#)), "8-3i");
        assert_eq!(t(&eval(r#"=IMSUB("1+2i","1+2i")"#)), "0");
        assert_eq!(e(&eval(r#"=IMSUB("x","1")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_args() {
        assert_eq!(t(&eval("=IMSUB(10,3)")), "7");
        assert_eq!(t(&eval("=IMSUB(2.5,1.5)")), "1");
    }

    #[test]
    fn negative_result() {
        assert_eq!(t(&eval(r#"=IMSUB("1","5+3i")"#)), "-4-3i");
        assert_eq!(t(&eval(r#"=IMSUB("0","i")"#)), "-i");
    }

    #[test]
    fn mixed_suffixes() {
        assert_eq!(t(&eval(r#"=IMSUB("13+4j","5+3i")"#)), "8+i");
    }

    #[test]
    fn imaginary_only_result() {
        assert_eq!(t(&eval(r#"=IMSUB("5+4i","5")"#)), "4i");
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval(r#"=IMSUB(TRUE,"1")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMSUB("1",FALSE)"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0+0i.
        assert_eq!(t(&eval(r#"=IMSUB(A1,"1+2i")"#)), "-1-2i");
        assert_eq!(t(&eval(r#"=IMSUB("1+2i",A1)"#)), "1+2i");
    }

    #[test]
    fn cell_ref_text() {
        assert_eq!(
            t(&eval_with(
                &[("A1", Value::Text("13+4i".into()))],
                r#"=IMSUB(A1,"5+3i")"#
            )),
            "8+i"
        );
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMSUB("3+4I","1")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMSUB("1","bad")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=IMSUB(1/0,"1")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=IMSUB("1",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=IMSUB("1")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMSUB("1","2","3")"#)), CalcError::Value);
    }
}
