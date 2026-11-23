//! `IMSUM(inumber1, [inumber2], ...)` — sum of 1–255 complex numbers,
//! as text: `Σ(a_k + b_k·i) = Σa_k + i·Σb_k`.
//! Spec: `docs/functions/IMSUM.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

use crate::common::complex::Complex;
use crate::engineering::improduct::fold_operands;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match fold_operands(ctx, args, Complex::ZERO, |a, b| a + b)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(z) => match z.require_finite() {
            Err(e) => Ok(Value::Error(crate::common::complex::im_error(e))),
            Ok(z) => Ok(Value::Text(z.to_text('i'))),
        },
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
        assert_eq!(t(&eval(r#"=IMSUM("3+4i","5-3i")"#)), "8+i");
        assert_eq!(t(&eval(r#"=IMSUM("1","2i","3")"#)), "4+2i");
        assert_eq!(t(&eval(r#"=IMSUM("5+3i")"#)), "5+3i");
        assert_eq!(e(&eval(r#"=IMSUM("x","1")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_args() {
        assert_eq!(t(&eval("=IMSUM(1,2,3)")), "6");
        assert_eq!(t(&eval("=IMSUM(2.5,0.5)")), "3");
    }

    #[test]
    fn mixed_suffixes() {
        assert_eq!(t(&eval(r#"=IMSUM("1+i","1+j")"#)), "2+2i");
    }

    #[test]
    fn cancellation() {
        assert_eq!(t(&eval(r#"=IMSUM("1+2i","-1-2i")"#)), "0");
    }

    #[test]
    fn negative_imaginary_result() {
        assert_eq!(t(&eval(r#"=IMSUM("1-5i","2")"#)), "3-5i");
    }

    #[test]
    fn range_sums_complex_text() {
        let v = eval_with(
            &[
                ("A1", Value::Text("3+4i".into())),
                ("A2", Value::Text("5-3i".into())),
            ],
            "=IMSUM(A1:A2)",
        );
        assert_eq!(t(&v), "8+i");
    }

    #[test]
    fn range_skips_blanks_and_bad_text() {
        // SPEC-OPEN per spec: blanks / non-complex text ignored in ranges.
        let v = eval_with(
            &[
                ("A1", Value::Text("1+i".into())),
                ("A2", Value::Text("hello".into())),
                ("A3", Value::Boolean(true)),
            ],
            "=IMSUM(A1:A3,2)",
        );
        assert_eq!(t(&v), "3+i");
    }

    #[test]
    fn range_error_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::DivZero))], "=IMSUM(A1,2)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn boolean_scalar_value_error() {
        assert_eq!(e(&eval(r#"=IMSUM("1",FALSE)"#)), CalcError::Value);
    }

    #[test]
    fn blank_scalar_is_zero() {
        // SPEC-OPEN: blank scalar treated as 0+0i.
        assert_eq!(t(&eval(r#"=IMSUM(A1,"2")"#)), "2");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=IMSUM(1/0,"2")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMSUM()")), CalcError::Value);
    }
}
