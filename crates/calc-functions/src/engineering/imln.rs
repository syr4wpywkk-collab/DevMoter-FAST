//! `IMLN(inumber)` — natural logarithm (principal value) of a complex
//! number, as text. Spec: `docs/functions/IMLN.md`.
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
    match z.ln() {
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
            &eval(r#"=IMLN("3+4i")"#),
            1.6094379124341003,
            0.9272952180016122,
        );
        assert_eq!(t(&eval(r#"=IMLN("1")"#)), "0");
        assert_z(&eval(r#"=IMLN("2.71828182845905")"#), 1.0, 0.0);
        assert_z(&eval(r#"=IMLN("-1")"#), 0.0, std::f64::consts::PI);
        assert_eq!(e(&eval(r#"=IMLN("0")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=IMLN(1)")), "0");
        assert_z(&eval("=IMLN(-1)"), 0.0, std::f64::consts::PI);
    }

    #[test]
    fn pure_imaginary() {
        // ln(2i) = ln2 + i·pi/2
        assert_z(
            &eval(r#"=IMLN("2i")"#),
            2f64.ln(),
            std::f64::consts::FRAC_PI_2,
        );
    }

    #[test]
    fn unit_circle() {
        // ln(i) = i·pi/2
        assert_z(&eval(r#"=IMLN("i")"#), 0.0, std::f64::consts::FRAC_PI_2);
    }

    #[test]
    fn j_suffix_input() {
        assert_z(
            &eval(r#"=IMLN("3+4j")"#),
            1.6094379124341003,
            0.9272952180016122,
        );
    }

    #[test]
    fn zero_num_error() {
        assert_eq!(e(&eval(r#"=IMLN("0+0i")"#)), CalcError::Num);
        assert_eq!(e(&eval("=IMLN(0)")), CalcError::Num);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMLN(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        // SPEC-OPEN: blank treated as 0 -> ln(0) = #NUM!.
        assert_eq!(e(&eval("=IMLN(A1)")), CalcError::Num);
    }

    #[test]
    fn unparsable_num() {
        assert_eq!(e(&eval(r#"=IMLN("abc")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMLN("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMLN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMLN()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMLN("1","2")"#)), CalcError::Value);
    }
}
