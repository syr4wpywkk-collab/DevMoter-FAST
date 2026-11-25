//! `IMAGINARY(inumber)` — imaginary coefficient `b` of a complex number
//! stored as text (`"x+yi"`/`"x+yj"`), or of a real number (`b = 0`).
//! Spec: `docs/functions/IMAGINARY.md`.
//!
//! Hosts the shared `inumber` argument evaluation
//! ([`eval_inumber`]/[`eval_inumber_silent`]) used by every `IM*` file in
//! this category — same role `dec2bin::eval_decimal` plays for `DEC2?`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::complex::{Complex, ComplexError};

/// Evaluate one `inumber` argument and report the parsed suffix letter
/// so text-returning `IM*` functions can preserve `j`
/// (SPEC-OPEN in the spec docs — preserving matches `IMCONJUGATE`'s
/// documented behavior):
///
/// - `Number` -> `n+0i`, suffix `'i'`
/// - `Text` -> [`Complex::parse_with_suffix`]; parse failure -> `#NUM!`
///   (MS docs list `#NUM!` for malformed complex text)
/// - `Boolean` -> `#VALUE!` (documented in the `IM*` specs)
/// - `Blank` -> `#NUM!` (SPEC-OPEN: Excel may instead treat it as
///   `0+0i` — see `IMAGINARY.md` "Open questions")
/// - `Error` propagates; `Array`/`Lambda`/`Reference` -> `#VALUE!`
pub(crate) fn eval_inumber(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<(Complex, char), CalcError>, EvalError> {
    Ok(match ctx.eval(arg)? {
        Value::Number(n) => Ok((Complex::real(n), 'i')),
        Value::Text(s) => Complex::parse_with_suffix(&s).map_err(|_| CalcError::Num),
        Value::Boolean(_) => Err(CalcError::Value),
        Value::Error(e) => Err(e),
        Value::Blank => Err(CalcError::Num),
        _ => Err(CalcError::Value),
    })
}

/// Worksheet error for a [`ComplexError`] raised by a complex
/// operation: `Parse`/`Num` -> `#NUM!`; `DivZero` is mapped per
/// function — `IMARGUMENT` documents `#DIV/0!`, while `IMDIV`, `IMCOT`,
/// `IMCSC` and `IMCSCH` document `#NUM!` (SPEC-OPEN in those specs).
pub(crate) fn complex_err(e: ComplexError, div_zero: CalcError) -> CalcError {
    match e {
        ComplexError::DivZero => div_zero,
        ComplexError::Parse | ComplexError::Num => CalcError::Num,
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_inumber(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok((z, _)) => Ok(Value::Number(z.im)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
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
        assert_eq!(n(&eval(r#"=IMAGINARY("3+4i")"#)), 4.0);
        assert_eq!(n(&eval(r#"=IMAGINARY("5-2j")"#)), -2.0);
        assert_eq!(n(&eval(r#"=IMAGINARY("7")"#)), 0.0);
        assert_eq!(n(&eval(r#"=IMAGINARY("-i")"#)), -1.0);
        assert_eq!(e(&eval(r#"=IMAGINARY("abc")"#)), CalcError::Num);
        assert_eq!(e(&eval("=IMAGINARY(TRUE)")), CalcError::Value);
    }

    #[test]
    fn real_number_arg() {
        assert_eq!(n(&eval("=IMAGINARY(5)")), 0.0);
        assert_eq!(n(&eval("=IMAGINARY(-2.5)")), 0.0);
    }

    #[test]
    fn bare_imaginary() {
        assert_eq!(n(&eval(r#"=IMAGINARY("4j")"#)), 4.0);
        assert_eq!(n(&eval(r#"=IMAGINARY("i")"#)), 1.0);
    }

    #[test]
    fn signed_and_scientific() {
        assert_eq!(n(&eval(r#"=IMAGINARY("-2-3.5i")"#)), -3.5);
        assert_eq!(n(&eval(r#"=IMAGINARY("1e2+2.5e-1i")"#)), 0.25);
    }

    #[test]
    fn uppercase_suffix_num() {
        // SPEC-OPEN: MS docs say uppercase I/J is not accepted.
        assert_eq!(e(&eval(r#"=IMAGINARY("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn malformed_num() {
        assert_eq!(e(&eval(r#"=IMAGINARY("2+ii")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMAGINARY("3+4")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMAGINARY("")"#)), CalcError::Num);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMAGINARY(FALSE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        // SPEC-OPEN: blank may coerce to 0+0i in Excel.
        assert_eq!(e(&eval("=IMAGINARY(A1)")), CalcError::Num);
    }

    #[test]
    fn cell_ref_text() {
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Text("3+4i".into()))],
                "=IMAGINARY(A1)"
            )),
            4.0
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMAGINARY(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMAGINARY()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMAGINARY("1","2")"#)), CalcError::Value);
    }
}
