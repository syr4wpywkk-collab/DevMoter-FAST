//! `IMSEC(inumber)` — secant `1/cos(z)` of a complex number, as text.
//! Spec: `docs/functions/IMSEC.md`.
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
    // `cos(z) = 0` -> DivZero; spec maps it to `#NUM!`/`#DIV/0!`
    // (SPEC-OPEN) — `#NUM!` per the family's documented majority.
    match z.sec().and_then(|w| w.require_finite()) {
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
            &eval(r#"=IMSEC("1+i")"#),
            0.4983370305551868,
            0.5910838417210451,
        );
        assert_eq!(t(&eval(r#"=IMSEC("0")"#)), "1");
        assert_z(&eval(r#"=IMSEC("1")"#), 1.8508157176809255, 0.0);
        assert_eq!(e(&eval(r#"=IMSEC("bad")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=IMSEC(0)")), "1");
        // sec(2) = 1/cos(2)
        assert_z(&eval("=IMSEC(2)"), 1.0 / 2f64.cos(), 0.0);
    }

    #[test]
    fn pure_imaginary() {
        // sec(i·y) = sech(y) (real)
        assert_z(&eval(r#"=IMSEC("i")"#), 1.0 / 1f64.cosh(), 0.0);
    }

    #[test]
    fn j_suffix_input() {
        assert_z(
            &eval(r#"=IMSEC("1+j")"#),
            0.4983370305551868,
            0.5910838417210451,
        );
    }

    #[test]
    fn near_pole_huge_magnitude() {
        // cos(pi/2) ~ 6e-17 in f64, so sec gives a huge finite result
        // rather than an error (mirrors the IMTAN note in common).
        let v = eval(r#"=IMSEC("1.5707963267948966")"#);
        assert!(z(&v).re.abs() > 1e15, "got {v:?}");
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMSEC(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0 -> sec(0) = 1.
        assert_eq!(t(&eval("=IMSEC(A1)")), "1");
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMSEC("x")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMSEC("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMSEC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMSEC()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMSEC("1","2")"#)), CalcError::Value);
    }
}
