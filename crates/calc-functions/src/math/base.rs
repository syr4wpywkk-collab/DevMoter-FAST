//! `BASE(number, radix, [min_length])` — converts a non-negative
//! decimal integer to text in `radix` (2–36), digits `0-9A-Z`.
//! Spec: `docs/functions/BASE.md`.
//!
//! `0 <= number < 2^53`, `2 <= radix <= 36`, `0 <= min_length <= 255`.
//! Non-integer arguments truncate toward zero (SPEC-OPEN — truncation
//! is the documented Excel behavior to confirm). Out-of-range values
//! -> `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

const MAX_NUMBER: f64 = 9.007_199_254_740_992e15; // 2^53

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0f64; 3];
    for (i, arg) in args.iter().enumerate() {
        nums[i] = match ctx.eval(arg)?.to_number() {
            Ok(n) => n,
            Err(e) => return Ok(Value::Error(e)),
        };
    }
    let number = nums[0].trunc();
    let radix = nums[1].trunc();
    let min_length = if args.len() == 3 {
        nums[2].trunc()
    } else {
        0.0
    };
    if !number.is_finite() || number < 0.0 || number >= MAX_NUMBER {
        return Ok(Value::Error(CalcError::Num));
    }
    if !(2.0..=36.0).contains(&radix) {
        return Ok(Value::Error(CalcError::Num));
    }
    if !(0.0..=255.0).contains(&min_length) {
        return Ok(Value::Error(CalcError::Num));
    }
    let mut n = number as u64;
    let radix = radix as u64;
    let mut digits = Vec::new();
    loop {
        digits.push(std::char::from_digit((n % radix) as u32, radix as u32).unwrap());
        n /= radix;
        if n == 0 {
            break;
        }
    }
    while digits.len() < min_length as usize {
        digits.push('0');
    }
    Ok(Value::Text(
        digits.iter().rev().collect::<String>().to_uppercase(),
    ))
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
        assert_eq!(t(&eval("=BASE(7,2)")), "111");
        assert_eq!(t(&eval("=BASE(100,16)")), "64");
        assert_eq!(t(&eval("=BASE(15,2,10)")), "0000001111");
    }

    #[test]
    fn radix36_letters() {
        assert_eq!(t(&eval("=BASE(35,36)")), "Z");
        assert_eq!(t(&eval("=BASE(36,36)")), "10");
    }

    #[test]
    fn zero() {
        assert_eq!(t(&eval("=BASE(0,2)")), "0");
        assert_eq!(t(&eval("=BASE(0,8,4)")), "0000");
    }

    #[test]
    fn truncation() {
        assert_eq!(t(&eval("=BASE(7.9,2)")), "111");
    }

    #[test]
    fn num_errors() {
        assert_eq!(e(&eval("=BASE(-1,2)")), CalcError::Num);
        assert_eq!(e(&eval("=BASE(10,1)")), CalcError::Num);
        assert_eq!(e(&eval("=BASE(10,37)")), CalcError::Num);
        assert_eq!(e(&eval("=BASE(10,2,256)")), CalcError::Num);
        assert_eq!(e(&eval("=BASE(10,2,-1)")), CalcError::Num);
        assert_eq!(e(&eval("=BASE(2^53,2)")), CalcError::Num);
    }

    #[test]
    fn max_valid() {
        assert_eq!(t(&eval("=BASE(2^53-1,16)")), "1FFFFFFFFFFFFF");
    }

    #[test]
    fn returns_text_not_number() {
        assert!(matches!(eval("=BASE(7,2)"), Value::Text(_)));
    }

    #[test]
    fn text_coerces() {
        assert_eq!(t(&eval(r#"=BASE("7","2","3")"#)), "111");
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BASE("x",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BASE(7,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_and_blank() {
        assert_eq!(t(&eval("=BASE(TRUE,2)")), "1");
        assert_eq!(t(&eval("=BASE(A1,2)")), "0");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BASE(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BASE(7)")), CalcError::Value);
        assert_eq!(e(&eval("=BASE(7,2,3,4)")), CalcError::Value);
    }
}
