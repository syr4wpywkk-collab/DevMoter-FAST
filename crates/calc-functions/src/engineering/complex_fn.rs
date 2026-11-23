//! `COMPLEX(real_num, i_num, [suffix])` — builds the canonical complex
//! text form (`"3+4i"`, `"2-j"`) consumed by the `IM*` family.
//! Spec: `docs/functions/COMPLEX.md`.
//! Format owned by [`crate::common::complex::Complex::to_text`].
//!
//! File is `complex_fn.rs` to avoid colliding with the
//! `crate::common::complex` module name (the `if_fn` convention).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::Complex;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let re = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let im = match ctx.eval(&args[1])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let suffix = if args.len() == 3 {
        match ctx.eval(&args[2])?.to_text() {
            Ok(s) => s,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        "i".to_string()
    };
    // SPEC-OPEN: uppercase "I"/"J" accepted here and normalized to
    // lowercase output (Excel lowercases the result).
    let suffix = match suffix.as_str() {
        s if s.eq_ignore_ascii_case("i") => 'i',
        s if s.eq_ignore_ascii_case("j") => 'j',
        _ => return Ok(Value::Error(CalcError::Value)),
    };
    Ok(Value::Text(Complex::new(re, im).to_text(suffix)))
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

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn spec_examples() {
        assert_eq!(t(&eval("=COMPLEX(3,4)")), "3+4i");
        assert_eq!(t(&eval(r#"=COMPLEX(3,4,"j")"#)), "3+4j");
        assert_eq!(t(&eval("=COMPLEX(0,1)")), "i");
        assert_eq!(t(&eval("=COMPLEX(2,0)")), "2");
        assert_eq!(e(&eval(r#"=COMPLEX(3,4,"k")"#)), CalcError::Value);
    }

    #[test]
    fn negative_imaginary() {
        assert_eq!(t(&eval("=COMPLEX(3,-4)")), "3-4i");
        assert_eq!(t(&eval("=COMPLEX(0,-1)")), "-i");
    }

    #[test]
    fn unit_imaginary_elided() {
        assert_eq!(t(&eval("=COMPLEX(3,1)")), "3+i");
        assert_eq!(t(&eval("=COMPLEX(3,-1)")), "3-i");
    }

    #[test]
    fn pure_imaginary() {
        assert_eq!(t(&eval("=COMPLEX(0,4)")), "4i");
        assert_eq!(t(&eval("=COMPLEX(0,-2.5)")), "-2.5i");
    }

    #[test]
    fn fractional_coefficients() {
        assert_eq!(t(&eval("=COMPLEX(0.5,0.75)")), "0.5+0.75i");
    }

    #[test]
    fn suffix_case_insensitive() {
        // SPEC-OPEN: "I"/"J" accepted, output lowercased.
        assert_eq!(t(&eval(r#"=COMPLEX(1,2,"J")"#)), "1+2j");
        assert_eq!(t(&eval(r#"=COMPLEX(1,2,"I")"#)), "1+2i");
    }

    #[test]
    fn text_and_bool_coefficients() {
        assert_eq!(t(&eval(r#"=COMPLEX("3","4")"#)), "3+4i");
        assert_eq!(t(&eval("=COMPLEX(TRUE,FALSE)")), "1");
    }

    #[test]
    fn blank_coefficient_zero() {
        assert_eq!(t(&eval("=COMPLEX(A1,4)")), "4i");
        assert_eq!(t(&eval("=COMPLEX(3,A1)")), "3");
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COMPLEX("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=COMPLEX(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn suffix_wrong_type_value_error() {
        assert_eq!(e(&eval(r#"=COMPLEX(1,2,"ij")"#)), CalcError::Value);
        assert_eq!(e(&eval("=COMPLEX(1,2,5)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COMPLEX(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=COMPLEX(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COMPLEX(1)")), CalcError::Value);
        assert_eq!(e(&eval("=COMPLEX(1,2,3,4)")), CalcError::Value);
    }
}
