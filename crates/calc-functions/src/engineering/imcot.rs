//! `IMCOT(inumber)` — cotangent of a complex number, as text:
//! `cot z = cos z / sin z`. `z = 0` -> `#NUM!` (SPEC-OPEN in the spec:
//! `#NUM!` vs `#DIV/0!`, `#NUM!` matches the `IMDIV` convention).
//! Spec: `docs/functions/IMCOT.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::engineering::imaginary::{complex_err, eval_inumber};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let (z, suffix) = match eval_inumber(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    match z.cot().and_then(|w| w.require_finite()) {
        Ok(w) => Ok(Value::Text(w.to_text(suffix))),
        Err(e) => Ok(Value::Error(complex_err(e, CalcError::Num))),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::complex::Complex;
    use calc_core::{CalcError, Value};

    fn c(v: &Value) -> Complex {
        match v {
            Value::Text(s) => Complex::parse(s).expect(s),
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn a(v: &Value, re: f64, im: f64) {
        let z = c(v);
        let tol = 1e-12 * re.abs().max(im.abs()).max(1.0);
        assert!(
            (z.re - re).abs() <= tol && (z.im - im).abs() <= tol,
            "got {z:?}, want ({re},{im})"
        );
    }

    #[test]
    fn spec_examples() {
        a(
            &eval(r#"=IMCOT("1+i")"#),
            0.2176215618544027,
            -0.8680141428959249,
        );
        a(&eval("=IMCOT(0.785398163397448)"), 1.0, 0.0);
        a(&eval(r#"=IMCOT("i")"#), 0.0, -1.3130352854993315);
        assert_eq!(e(&eval(r#"=IMCOT("bad")"#)), CalcError::Num);
    }

    #[test]
    fn zero_is_num() {
        // SPEC-OPEN: #NUM! vs #DIV/0! (IMCOT.md).
        assert_eq!(e(&eval(r#"=IMCOT("0")"#)), CalcError::Num);
        assert_eq!(e(&eval("=IMCOT(0)")), CalcError::Num);
    }

    #[test]
    fn pure_imaginary_is_icoth() {
        a(&eval(r#"=IMCOT("2i")"#), 0.0, -1.0 / 2f64.tanh());
    }

    #[test]
    fn j_suffix_preserved() {
        match eval(r#"=IMCOT("1+1j")"#) {
            Value::Text(s) => assert!(s.ends_with('j'), "{s}"),
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMCOT(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval("=IMCOT(A1)")), CalcError::Num);
    }

    #[test]
    fn malformed_num() {
        assert_eq!(e(&eval(r#"=IMCOT("1+i/2")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMCOT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMCOT()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMCOT("1","2")"#)), CalcError::Value);
    }
}
