//! `IMEXP(inumber)` — exponential `e^z` of a complex number, as text.
//! Spec: `docs/functions/IMEXP.md`.
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
    let z = match scalar_operand(&ctx.eval(&args[0])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    match z.exp().require_finite() {
        Err(e) => Ok(Value::Error(crate::common::complex::im_error(e))),
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
        // e·(cos1 + i·sin1)
        assert_z(
            &eval(r#"=IMEXP("1+i")"#),
            1.4686939399158851,
            2.2873552871788423,
        );
        assert_eq!(t(&eval(r#"=IMEXP("0")"#)), "1");
        assert_z(&eval(r#"=IMEXP("1")"#), std::f64::consts::E, 0.0);
        assert_eq!(e(&eval(r#"=IMEXP("bad")"#)), CalcError::Num);
    }

    #[test]
    fn exp_of_i_pi() {
        // e^(i*pi) ~ -1 with ~1e-16 imaginary residue; assert on the
        // parsed components, not the exact string (spec open question).
        assert_z(&eval(r#"=IMEXP("3.14159265358979i")"#), -1.0, 0.0);
    }

    #[test]
    fn real_and_numeric_args() {
        assert_eq!(t(&eval("=IMEXP(0)")), "1");
        assert_z(&eval("=IMEXP(2)"), 2f64.exp(), 0.0);
    }

    #[test]
    fn negative_real() {
        assert_z(&eval(r#"=IMEXP("-1")"#), (-1f64).exp(), 0.0);
    }

    #[test]
    fn pure_imaginary() {
        // e^(i) = cos1 + i·sin1
        assert_z(&eval(r#"=IMEXP("i")"#), 1f64.cos(), 1f64.sin());
    }

    #[test]
    fn j_suffix_input() {
        assert_z(
            &eval(r#"=IMEXP("1+j")"#),
            1.4686939399158851,
            2.2873552871788423,
        );
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMEXP(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // SPEC-OPEN: blank treated as 0 -> e^0 = 1.
        assert_eq!(t(&eval("=IMEXP(A1)")), "1");
    }

    #[test]
    fn overflow_num() {
        // e^1e308 overflows f64 -> #NUM!, never inf text.
        assert_eq!(e(&eval(r#"=IMEXP("1e308")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMEXP(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMEXP()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMEXP("1","2")"#)), CalcError::Value);
    }
}
