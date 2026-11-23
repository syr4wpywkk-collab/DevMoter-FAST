//! `IMTAN(inumber)` — tangent `sin(z)/cos(z)` of a complex number, as
//! text. Spec: `docs/functions/IMTAN.md`.
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
    // At the poles `cos(z) = 0` (re = pi/2 + k·pi, im = 0) f64 gives a
    // huge-magnitude finite result rather than an exact zero — matching
    // the spec's documented expectation (SPEC-OPEN: error vs ~1e16).
    match z.tan().and_then(|w| w.require_finite()) {
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
            &eval(r#"=IMTAN("1+i")"#),
            0.27175258531951185,
            1.0839233273386946,
        );
        assert_z(&eval(r#"=IMTAN("0.785398163397448")"#), 1.0, 0.0);
        assert_z(&eval(r#"=IMTAN("i")"#), 0.0, 1f64.tanh());
        assert_eq!(t(&eval(r#"=IMTAN("0")"#)), "0");
        assert_eq!(e(&eval(r#"=IMTAN("bad")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg_matches_tan() {
        assert_z(&eval("=IMTAN(1)"), 1f64.tan(), 0.0);
    }

    #[test]
    fn pure_imaginary_is_i_tanh() {
        assert_z(&eval(r#"=IMTAN("2i")"#), 0.0, 2f64.tanh());
    }

    #[test]
    fn near_pole_huge_magnitude() {
        // tan(pi/2): f64 cos ~ 6e-17 -> huge finite result (SPEC-OPEN).
        let v = eval(r#"=IMTAN("1.5707963267948966")"#);
        assert!(z(&v).re.abs() > 1e15, "got {v:?}");
    }

    #[test]
    fn j_suffix_input() {
        assert_z(&eval(r#"=IMTAN("j")"#), 0.0, 1f64.tanh());
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMTAN(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0 -> tan(0) = 0.
        assert_eq!(t(&eval("=IMTAN(A1)")), "0");
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMTAN("x")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMTAN("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMTAN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMTAN()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMTAN("1","2")"#)), CalcError::Value);
    }
}
