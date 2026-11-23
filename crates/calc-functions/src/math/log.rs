//! `LOG(number, [base])` — logarithm of `number` in `base` (default 10).
//! Spec: `docs/functions/LOG.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let base = if args.len() == 2 {
        match ctx.eval(&args[1])?.to_number() {
            Ok(n) => n,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        10.0
    };
    if x <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    // base <= 0 or base == 1 -> #NUM! (SPEC-OPEN: base=1 error kind —
    // some references report #DIV/0!).
    if base <= 0.0 || base == 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x.ln() / base.ln()))
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
    fn default_base10() {
        assert_eq!(n(&eval("=LOG(100)")), 2.0);
        assert!((n(&eval("=LOG(5)")) - 0.6989700043360189).abs() < 1e-12);
    }

    #[test]
    fn explicit_base() {
        assert_eq!(n(&eval("=LOG(8,2)")), 3.0);
        assert!((n(&eval("=LOG(100,2)")) - std::f64::consts::LOG2_10 * 2.0).abs() < 1e-12);
    }

    #[test]
    fn log_of_one() {
        assert_eq!(n(&eval("=LOG(1)")), 0.0);
        assert_eq!(n(&eval("=LOG(1,7)")), 0.0);
    }

    #[test]
    fn nonpositive_number_num() {
        assert_eq!(e(&eval("=LOG(0)")), CalcError::Num);
        assert_eq!(e(&eval("=LOG(-5)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_base_num() {
        assert_eq!(e(&eval("=LOG(10,0)")), CalcError::Num);
        assert_eq!(e(&eval("=LOG(10,-2)")), CalcError::Num);
    }

    #[test]
    fn base_one_num() {
        // SPEC-OPEN: Excel returns #NUM! for base 1 (confirm vs #DIV/0!).
        assert_eq!(e(&eval("=LOG(10,1)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=LOG("100","10")"#)), 2.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=LOG("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=LOG(10,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        // TRUE coerces to 1 -> base 1 error.
        assert_eq!(e(&eval("=LOG(10,TRUE)")), CalcError::Num);
        assert_eq!(n(&eval("=LOG(TRUE)")), 0.0);
    }

    #[test]
    fn blank_ref_is_zero_num() {
        assert_eq!(e(&eval("=LOG(A1)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LOG(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=LOG(10,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LOG(1,2,3)")), CalcError::Value);
    }
}
