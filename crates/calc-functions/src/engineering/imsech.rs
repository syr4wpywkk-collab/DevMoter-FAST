//! `IMSECH(inumber)` — hyperbolic secant `1/cosh(z)` of a complex
//! number, as text. Spec: `docs/functions/IMSECH.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::{im_error, scalar_operand};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let z = match scalar_operand(&ctx.eval(&args[0])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    // `cosh(z) = 0` -> DivZero; spec maps it to `#NUM!`/`#DIV/0!`
    // (SPEC-OPEN) — `#NUM!` per the family's documented majority.
    match z.sech().and_then(|w| w.require_finite()) {
        Err(e) => Ok(Value::Error(im_error(e))),
        Ok(w) => Ok(Value::Text(w.to_text('i'))),
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

    fn z(v: &Value) -> crate::common::complex::Complex {
        let Value::Text(s) = v else {
            panic!("expected text, got {v:?}")
        };
        crate::common::complex::Complex::parse(s).unwrap()
    }

    /// Compare rendered complex text to expected components with a
    /// tolerance: the engine prints shortest-round-trip digits while
    /// the spec examples are Excel's 15-sig-digit rendering.
    fn assert_z(v: &Value, re: f64, im: f64) {
        let z = z(v);
        let tol = 1e-13 * re.abs().max(im.abs()).max(1.0);
        assert!(
            (z.re - re).abs() <= tol && (z.im - im).abs() <= tol,
            "expected {re}+{im}i, got {z:?}"
        );
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn spec_examples() {
        assert_z(
            &eval(r#"=IMSECH("1+i")"#),
            0.4983370305551868,
            -0.5910838417210451,
        );
        assert_eq!(t(&eval(r#"=IMSECH("0")"#)), "1");
        assert_z(&eval(r#"=IMSECH("1")"#), 0.6480542736638855, 0.0);
        assert_eq!(e(&eval(r#"=IMSECH("bad")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg() {
        // sech(2) = 1/cosh(2)
        assert_z(&eval("=IMSECH(2)"), 1.0 / 2f64.cosh(), 0.0);
    }

    #[test]
    fn pure_imaginary() {
        // sech(i·y) = sec(y) (real)
        assert_z(&eval(r#"=IMSECH("i")"#), 1.0 / 1f64.cos(), 0.0);
    }

    #[test]
    fn j_suffix_input() {
        assert_z(
            &eval(r#"=IMSECH("1+j")"#),
            0.4983370305551868,
            -0.5910838417210451,
        );
    }

    #[test]
    fn negative_arg() {
        // cosh is even in re: sech(-1) = sech(1)
        assert_z(&eval(r#"=IMSECH("-1")"#), 0.6480542736638855, 0.0);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMSECH(FALSE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0 -> sech(0) = 1.
        assert_eq!(t(&eval("=IMSECH(A1)")), "1");
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMSECH("x")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMSECH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMSECH()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMSECH("1","2")"#)), CalcError::Value);
    }
}
