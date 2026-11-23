//! `IMDIV(inumber1, inumber2)` — quotient of two complex numbers, as
//! text. Divisor `0+0i` -> `#NUM!` (MS docs; SPEC-OPEN vs `#DIV/0!`).
//! Spec: `docs/functions/IMDIV.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::engineering::imaginary::{complex_err, eval_inumber};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let (z1, suffix) = match eval_inumber(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let (z2, _) = match eval_inumber(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    match z1.checked_div(z2).and_then(|w| w.require_finite()) {
        // SPEC-OPEN: output suffix follows inumber1 (IMDIV.md asks
        // whether a j input yields j output).
        Ok(w) => Ok(Value::Text(w.to_text(suffix))),
        Err(e) => Ok(Value::Error(complex_err(e, CalcError::Num))),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use crate::common::complex::Complex;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn c(v: &Value) -> Complex {
        Complex::parse(t(v)).unwrap()
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
        a(&eval(r#"=IMDIV("1+2i","3+4i")"#), 0.44, 0.08);
        a(&eval(r#"=IMDIV("-238+240i","10+24i")"#), 5.0, 12.0);
        a(&eval(r#"=IMDIV("6","3")"#), 2.0, 0.0);
        assert_eq!(e(&eval(r#"=IMDIV("1","0")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMDIV("x","1")"#)), CalcError::Num);
    }

    #[test]
    fn real_numbers() {
        assert_eq!(t(&eval(r#"=IMDIV(7,2)"#)), "3.5");
    }

    #[test]
    fn mixed_suffixes_legal() {
        a(&eval(r#"=IMDIV("1+i","1+1j")"#), 1.0, 0.0);
    }

    #[test]
    fn first_suffix_used() {
        match eval(r#"=IMDIV("1+2j","1+j")"#) {
            Value::Text(s) => assert!(s.ends_with('j'), "{s}"),
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn zero_divisor_num() {
        assert_eq!(e(&eval(r#"=IMDIV("1+i","0i")"#)), CalcError::Num);
        assert_eq!(e(&eval("=IMDIV(1,0)")), CalcError::Num);
    }

    #[test]
    fn large_divisor_no_overflow() {
        let z = c(&eval(r#"=IMDIV("1+1i","1e200-1e200i")"#));
        assert!(z.is_finite());
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval(r#"=IMDIV(TRUE,"1")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMDIV("1",FALSE)"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval(r#"=IMDIV("1",A1)"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=IMDIV(1/0,"1")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=IMDIV("1",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=IMDIV("1")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMDIV("1","2","3")"#)), CalcError::Value);
    }
}
