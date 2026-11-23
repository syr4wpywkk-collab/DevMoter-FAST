//! `POWER(number, power)` — `number` raised to `power`.
//! Spec: `docs/functions/POWER.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let base = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let exp = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(power(base, exp))
}

fn power(base: f64, exp: f64) -> Value {
    // Excel: x^0 == 1 for every finite x, including 0^0 -> 1.
    if exp == 0.0 {
        return Value::Number(1.0);
    }
    if base == 0.0 {
        // 0^negative is a #NUM! in Excel (SPEC-OPEN: some engines #DIV/0!).
        return if exp < 0.0 {
            Value::Error(CalcError::Num)
        } else {
            Value::Number(0.0)
        };
    }
    if base < 0.0 && exp != exp.trunc() {
        // Negative base, non-integer exponent: undefined in reals (#NUM!).
        return Value::Error(CalcError::Num);
    }
    let r = base.powf(exp);
    if r.is_nan() || r.is_infinite() {
        // Overflow / NaN surface as #NUM!, never inf.
        return Value::Error(CalcError::Num);
    }
    Value::Number(r)
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
    fn basic() {
        assert_eq!(n(&eval("=POWER(2,3)")), 8.0);
        assert_eq!(n(&eval("=POWER(4,0.5)")), 2.0);
    }

    #[test]
    fn negative_base_integer_exponent() {
        assert_eq!(n(&eval("=POWER(-2,3)")), -8.0);
        assert_eq!(n(&eval("=POWER(-2,2)")), 4.0);
    }

    #[test]
    fn negative_base_noninteger_num() {
        // POWER(-8,1/3) is #NUM! — Excel does not take the real cube root.
        assert_eq!(e(&eval("=POWER(-8,1/3)")), CalcError::Num);
        assert_eq!(e(&eval("=POWER(-2,0.5)")), CalcError::Num);
    }

    #[test]
    fn zero_to_zero_is_one() {
        assert_eq!(n(&eval("=POWER(0,0)")), 1.0);
        assert_eq!(n(&eval("=POWER(-5,0)")), 1.0);
    }

    #[test]
    fn zero_negative_exponent_num() {
        assert_eq!(e(&eval("=POWER(0,-1)")), CalcError::Num);
    }

    #[test]
    fn zero_positive_exponent() {
        assert_eq!(n(&eval("=POWER(0,2)")), 0.0);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=POWER(1E200,2)")), CalcError::Num);
        assert_eq!(e(&eval("=POWER(10,400)")), CalcError::Num);
    }

    #[test]
    fn underflow_zero() {
        assert_eq!(n(&eval("=POWER(1E-200,2)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=POWER("2","10")"#)), 1024.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=POWER("x",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=POWER(2,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=POWER(9,FALSE)")), 1.0);
        assert_eq!(n(&eval("=POWER(2,TRUE)")), 2.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=POWER(A1,3)")), 0.0);
        assert_eq!(n(&eval("=POWER(7,A1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=POWER(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval("=POWER(2,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=POWER(2)")), CalcError::Value);
    }
}
