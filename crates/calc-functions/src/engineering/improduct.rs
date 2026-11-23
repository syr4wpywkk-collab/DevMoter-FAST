//! `IMPRODUCT(inumber1, [inumber2], ...)` — product of 1–255 complex
//! numbers, as text: `(a+bi)(c+di) = (ac−bd) + (ad+bc)i`.
//! Spec: `docs/functions/IMPRODUCT.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

use crate::common::coercion::flatten_args;
use crate::common::complex::{Complex, ranged_operand, scalar_operand};

/// Shared variadic aggregation for `IMSUM`/`IMPRODUCT`: evaluates and
/// flattens every argument (eager), folding scalar operands through
/// [`scalar_operand`] and range members through [`ranged_operand`]
/// into `acc`.
pub(crate) fn fold_operands(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    acc: Complex,
    combine: impl Fn(Complex, Complex) -> Complex,
) -> Result<Result<Complex, calc_core::error::CalcError>, EvalError> {
    let flat = flatten_args(ctx, args)?;
    let mut acc = acc;
    for (v, ranged) in flat {
        let operand = if ranged {
            match ranged_operand(&v) {
                None => continue,
                Some(r) => r,
            }
        } else {
            scalar_operand(&v)
        };
        match operand {
            Err(e) => return Ok(Err(e)),
            Ok(z) => acc = combine(acc, z),
        }
    }
    Ok(Ok(acc))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match fold_operands(ctx, args, Complex::ONE, |a, b| a * b)? {
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
        assert_eq!(t(&eval(r#"=IMPRODUCT("3+4i","5-3i")"#)), "27+11i");
        assert_eq!(t(&eval(r#"=IMPRODUCT("1+2i",30)"#)), "30+60i");
        assert_eq!(t(&eval(r#"=IMPRODUCT("2","3","4")"#)), "24");
        assert_eq!(t(&eval(r#"=IMPRODUCT("i","i")"#)), "-1");
        assert_eq!(e(&eval(r#"=IMPRODUCT("x","1")"#)), CalcError::Num);
    }

    #[test]
    fn single_arg() {
        assert_eq!(t(&eval(r#"=IMPRODUCT("5+3i")"#)), "5+3i");
    }

    #[test]
    fn numeric_args() {
        assert_eq!(t(&eval("=IMPRODUCT(2,3,4)")), "24");
        assert_eq!(t(&eval("=IMPRODUCT(2.5)")), "2.5");
    }

    #[test]
    fn mixed_suffixes() {
        assert_eq!(t(&eval(r#"=IMPRODUCT("1+i","1+j")"#)), "2i");
    }

    #[test]
    fn conjugate_product_is_real() {
        // (a+bi)(a-bi) = a²+b²
        assert_eq!(t(&eval(r#"=IMPRODUCT("3+4i","3-4i")"#)), "25");
    }

    #[test]
    fn range_multiplies_complex_text() {
        let v = eval_with(
            &[
                ("A1", Value::Text("3+4i".into())),
                ("A2", Value::Text("5-3i".into())),
            ],
            "=IMPRODUCT(A1:A2)",
        );
        assert_eq!(t(&v), "27+11i");
    }

    #[test]
    fn range_skips_blanks_and_bad_text() {
        // SPEC-OPEN per spec: blanks / non-complex text ignored in ranges.
        let v = eval_with(
            &[
                ("A1", Value::Text("2".into())),
                ("A2", Value::Text("hello".into())),
                ("A3", Value::Boolean(true)),
            ],
            "=IMPRODUCT(A1:A3,3)",
        );
        assert_eq!(t(&v), "6");
    }

    #[test]
    fn range_error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=IMPRODUCT(A1,2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn boolean_scalar_value_error() {
        assert_eq!(e(&eval(r#"=IMPRODUCT("1",TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn blank_cell_ref_skipped() {
        // A blank cell ref is range-derived, so it is skipped like any
        // other blank range member -> product of the remaining args.
        assert_eq!(t(&eval(r#"=IMPRODUCT(A1,"2")"#)), "2");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=IMPRODUCT(1/0,"2")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMPRODUCT()")), CalcError::Value);
    }
}
