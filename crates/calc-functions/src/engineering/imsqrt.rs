//! `IMSQRT(inumber)` — principal square root of a complex number, as
//! text: `sqrt(r)·e^(iθ/2)`, `θ ∈ (−π, π]` — the result always lies in
//! the closed right half-plane. Spec: `docs/functions/IMSQRT.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

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
        Ok(z) => Ok(Value::Text(z.sqrt().to_text('i'))),
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
        assert_eq!(t(&eval(r#"=IMSQRT("4")"#)), "2");
        assert_z(
            &eval(r#"=IMSQRT("1+i")"#),
            1.0986841134678098,
            0.45508986056222733,
        );
        assert_z(
            &eval(r#"=IMSQRT("i")"#),
            std::f64::consts::FRAC_1_SQRT_2,
            std::f64::consts::FRAC_1_SQRT_2,
        );
        assert_eq!(e(&eval(r#"=IMSQRT("bad")"#)), CalcError::Num);
    }

    #[test]
    fn negative_real_axis() {
        // Principal branch: sqrt(-4) = +2i (right half-plane).
        // SPEC-OPEN per spec: sign on the negative real axis.
        assert_z(&eval(r#"=IMSQRT("-4")"#), 0.0, 2.0);
        assert_z(&eval(r#"=IMSQRT("-9")"#), 0.0, 3.0);
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=IMSQRT(16)")), "4");
        assert_eq!(t(&eval("=IMSQRT(0)")), "0");
        assert_z(&eval("=IMSQRT(2)"), 2f64.sqrt(), 0.0);
    }

    #[test]
    fn negative_imaginary() {
        // sqrt(-i) stays in the right half-plane: re > 0, im < 0.
        assert_z(
            &eval(r#"=IMSQRT("-i")"#),
            std::f64::consts::FRAC_1_SQRT_2,
            -std::f64::consts::FRAC_1_SQRT_2,
        );
    }

    #[test]
    fn j_suffix_input() {
        assert_z(
            &eval(r#"=IMSQRT("j")"#),
            std::f64::consts::FRAC_1_SQRT_2,
            std::f64::consts::FRAC_1_SQRT_2,
        );
    }

    #[test]
    fn squares_back() {
        // IMSQRT(z)^2 = z on the principal branch.
        let Value::Text(s) = eval(r#"=IMSQRT("3-4i")"#) else {
            panic!()
        };
        let w = crate::common::complex::Complex::parse(&s).unwrap();
        let back = w * w;
        assert!((back.re - 3.0).abs() < 1e-12 && (back.im + 4.0).abs() < 1e-12);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMSQRT(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0 -> sqrt(0) = 0.
        assert_eq!(t(&eval("=IMSQRT(A1)")), "0");
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMSQRT("x")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMSQRT("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMSQRT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMSQRT()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMSQRT("1","2")"#)), CalcError::Value);
    }
}
