//! `IMCOSH(inumber)` — hyperbolic cosine of a complex number, as text:
//! `cosh(x+yi) = cosh x·cos y + i·sinh x·sin y`.
//! Spec: `docs/functions/IMCOSH.md`.

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
    match z.cosh().require_finite() {
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
            &eval(r#"=IMCOSH("1+i")"#),
            0.8337300251311491,
            0.9888977057628651,
        );
        a(&eval(r#"=IMCOSH("0")"#), 1.0, 0.0);
        a(&eval(r#"=IMCOSH("1")"#), 1.5430806348152437, 0.0);
        a(&eval(r#"=IMCOSH("i")"#), 0.5403023058681398, 0.0);
        assert_eq!(e(&eval(r#"=IMCOSH("bad")"#)), CalcError::Num);
    }

    #[test]
    fn pure_imaginary_is_cos() {
        a(&eval(r#"=IMCOSH("2i")"#), 2f64.cos(), 0.0);
    }

    #[test]
    fn even_in_imaginary() {
        a(
            &eval(r#"=IMCOSH("1-i")"#),
            1f64.cosh() * 1f64.cos(),
            -1f64.sinh() * 1f64.sin(),
        );
    }

    #[test]
    fn j_suffix_preserved() {
        match eval(r#"=IMCOSH("1+1j")"#) {
            Value::Text(s) => assert!(s.ends_with('j'), "{s}"),
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMCOSH(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval("=IMCOSH(A1)")), CalcError::Num);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval(r#"=IMCOSH("1e300")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMCOSH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMCOSH()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMCOSH("1","2")"#)), CalcError::Value);
    }
}
