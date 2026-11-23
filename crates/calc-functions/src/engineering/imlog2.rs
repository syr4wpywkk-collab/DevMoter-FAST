//! `IMLOG2(inumber)` — base-2 logarithm (principal value) of a
//! complex number, as text: `ln(z)/ln(2)`.
//! Spec: `docs/functions/IMLOG2.md`.
//! Arithmetic/format owned by [`crate::common::complex`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::{Complex, im_error, scalar_operand};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let z = match scalar_operand(&ctx.eval(&args[0])?) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    // Divide (not multiply-by-reciprocal) so exact powers of two like
    // `IMLOG2("2")` render "1" rather than "0.9999999999999999".
    match z
        .ln()
        .map(|w| Complex::new(w.re / 2f64.ln(), w.im / 2f64.ln()))
    {
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
        assert_z(&eval(r#"=IMLOG2("8")"#), 3.0, 0.0);
        assert_eq!(t(&eval(r#"=IMLOG2("2")"#)), "1");
        assert_z(
            &eval(r#"=IMLOG2("3+4i")"#),
            2.321928094887362,
            1.3378042124509761,
        );
        assert_eq!(e(&eval(r#"=IMLOG2("0")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg() {
        assert_z(&eval("=IMLOG2(1024)"), 10.0, 0.0);
        assert_eq!(t(&eval("=IMLOG2(1)")), "0");
    }

    #[test]
    fn negative_real() {
        // log2(-1) = i·pi/ln2 (principal branch), unlike LOG(-1,2).
        assert_z(
            &eval(r#"=IMLOG2("-1")"#),
            0.0,
            std::f64::consts::PI / 2f64.ln(),
        );
    }

    #[test]
    fn pure_imaginary() {
        // log2(2i) = 1 + i·(pi/2)/ln2
        assert_z(
            &eval(r#"=IMLOG2("2i")"#),
            1.0,
            std::f64::consts::FRAC_PI_2 / 2f64.ln(),
        );
    }

    #[test]
    fn j_suffix_input() {
        assert_z(
            &eval(r#"=IMLOG2("3+4j")"#),
            2.321928094887362,
            1.3378042124509761,
        );
    }

    #[test]
    fn fractional_power_of_two() {
        assert_z(&eval("=IMLOG2(1.4142135623731)"), 0.5, 0.0);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMLOG2(FALSE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        // SPEC-OPEN: blank treated as 0 -> #NUM!.
        assert_eq!(e(&eval("=IMLOG2(A1)")), CalcError::Num);
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMLOG2("x")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMLOG2(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMLOG2()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMLOG2("1","2")"#)), CalcError::Value);
    }
}
