//! `IMCSC(inumber)` — cosecant of a complex number, as text:
//! `csc z = 1 / sin z`. `z = 0` -> `#NUM!` (SPEC-OPEN in the spec).
//! Spec: `docs/functions/IMCSC.md`.

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
    match z.csc().and_then(|w| w.require_finite()) {
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
            &eval(r#"=IMCSC("1+i")"#),
            0.6215180171704284,
            -0.3039310016284264,
        );
        a(&eval("=IMCSC(1.5707963267949)"), 1.0, 0.0);
        a(&eval(r#"=IMCSC("i")"#), 0.0, -0.8509181282393216);
        assert_eq!(e(&eval(r#"=IMCSC("bad")"#)), CalcError::Num);
    }

    #[test]
    fn zero_is_num() {
        // SPEC-OPEN: #NUM! vs #DIV/0! (IMCSC.md).
        assert_eq!(e(&eval(r#"=IMCSC("0")"#)), CalcError::Num);
    }

    #[test]
    fn pure_imaginary() {
        a(&eval(r#"=IMCSC("2i")"#), 0.0, -1.0 / 2f64.sinh());
    }

    #[test]
    fn negative_real() {
        a(&eval(r#"=IMCSC("-1")"#), -1.0 / 1f64.sin(), 0.0);
    }

    #[test]
    fn j_suffix_preserved() {
        match eval(r#"=IMCSC("1+1j")"#) {
            Value::Text(s) => assert!(s.ends_with('j'), "{s}"),
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMCSC(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval("=IMCSC(A1)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMCSC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMCSC()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMCSC("1","2")"#)), CalcError::Value);
    }
}
