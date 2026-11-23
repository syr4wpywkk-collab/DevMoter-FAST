//! `IMSINH(inumber)` — hyperbolic sine of a complex number, as text:
//! `sinh(x+yi) = sinh x·cos y + i·cosh x·sin y`.
//! Spec: `docs/functions/IMSINH.md`.
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
    match z.sinh().require_finite() {
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
            &eval(r#"=IMSINH("1+i")"#),
            0.6349639147847361,
            1.2984575814159773,
        );
        assert_eq!(t(&eval(r#"=IMSINH("0")"#)), "0");
        assert_z(&eval(r#"=IMSINH("1")"#), 1f64.sinh(), 0.0);
        assert_z(&eval(r#"=IMSINH("i")"#), 0.0, 1f64.sin());
        assert_eq!(e(&eval(r#"=IMSINH("bad")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg_matches_sinh() {
        assert_z(&eval("=IMSINH(2)"), 2f64.sinh(), 0.0);
    }

    #[test]
    fn pure_imaginary_is_i_sin() {
        assert_z(&eval(r#"=IMSINH("2i")"#), 0.0, 2f64.sin());
    }

    #[test]
    fn negative_arg() {
        // sinh is odd.
        assert_z(&eval(r#"=IMSINH("-1")"#), -1f64.sinh(), 0.0);
    }

    #[test]
    fn j_suffix_input() {
        assert_z(&eval(r#"=IMSINH("j")"#), 0.0, 1f64.sin());
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMSINH(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0 -> sinh(0) = 0.
        assert_eq!(t(&eval("=IMSINH(A1)")), "0");
    }

    #[test]
    fn overflow_num() {
        // sinh(1e308) overflows f64 -> #NUM!.
        assert_eq!(e(&eval(r#"=IMSINH("1e308")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMSINH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMSINH()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMSINH("1","2")"#)), CalcError::Value);
    }
}
