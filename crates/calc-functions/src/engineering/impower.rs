//! `IMPOWER(inumber, number)` — complex number raised to a power, as
//! text: `inumber ^ number` via the principal polar form `r^n·e^(inθ)`.
//! Spec: `docs/functions/IMPOWER.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::{im_error, scalar_operand};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let z = match scalar_operand(&ctx.eval(&args[0])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    // MS docs allow the `number` exponent itself to be complex text
    // (SPEC-OPEN in the spec doc); a real exponent takes the polar
    // `pow_real` path so `0^n` keeps its documented semantics.
    let w = match scalar_operand(&ctx.eval(&args[1])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(w) => w,
    };
    let result = if w.im == 0.0 {
        z.pow_real(w.re)
    } else {
        z.pow_complex(w)
    };
    match result.and_then(|r| r.require_finite()) {
        Err(e) => Ok(Value::Error(im_error(e))),
        Ok(r) => Ok(Value::Text(r.to_text('i'))),
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
        // (2+3i)^3 = -46+9i (tiny polar-form float residue).
        assert_z(&eval(r#"=IMPOWER("2+3i",3)"#), -46.0, 9.0);
        assert_eq!(t(&eval(r#"=IMPOWER("2",10)"#)), "1024");
        assert_eq!(t(&eval(r#"=IMPOWER("4",0.5)"#)), "2");
        assert_eq!(e(&eval(r#"=IMPOWER("bad",2)"#)), CalcError::Num);
    }

    #[test]
    fn i_squared() {
        // i^2 = -1 with tiny float residue on the imaginary part.
        assert_z(&eval(r#"=IMPOWER("0+1i",2)"#), -1.0, 0.0);
    }

    #[test]
    fn numeric_args() {
        assert_eq!(t(&eval("=IMPOWER(2,3)")), "8");
        assert_eq!(t(&eval("=IMPOWER(2,-1)")), "0.5");
    }

    #[test]
    fn fractional_exponent_principal_root() {
        // sqrt(4) principal root = +2; sqrt(-4) = +2i.
        assert_z(&eval(r#"=IMPOWER("-4",0.5)"#), 0.0, 2.0);
        assert_eq!(t(&eval(r#"=IMPOWER("9",0.5)"#)), "3");
    }

    #[test]
    fn complex_exponent() {
        // SPEC-OPEN per spec: i^i = e^(-pi/2) (real).
        assert_z(
            &eval(r#"=IMPOWER("i","i")"#),
            (-std::f64::consts::FRAC_PI_2).exp(),
            0.0,
        );
    }

    #[test]
    fn zero_base() {
        assert_eq!(t(&eval(r#"=IMPOWER("0",2)"#)), "0");
        // SPEC-OPEN: 0^0 and 0^-1 -> #NUM! (spec allows #DIV/0!).
        assert_eq!(e(&eval(r#"=IMPOWER("0",0)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMPOWER("0",-1)"#)), CalcError::Num);
    }

    #[test]
    fn mixed_suffixes() {
        assert_z(&eval(r#"=IMPOWER("2+3j","2")"#), -5.0, 12.0);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval(r#"=IMPOWER(TRUE,2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMPOWER("2",FALSE)"#)), CalcError::Value);
    }

    #[test]
    fn text_exponent_coerces() {
        assert_eq!(t(&eval(r#"=IMPOWER("2","10")"#)), "1024");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=IMPOWER(1/0,2)"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=IMPOWER("2",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=IMPOWER("2")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMPOWER("2",2,2)"#)), CalcError::Value);
    }
}
