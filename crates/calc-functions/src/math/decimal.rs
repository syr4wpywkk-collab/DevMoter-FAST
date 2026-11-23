//! `DECIMAL(text, radix)` — converts `text` in base `radix` (2–36) to a
//! decimal integer. Spec: `docs/functions/DECIMAL.md`.
//!
//! Open semantics follow the spec doc's SPEC-OPEN flags: a numeric `text`
//! argument coerces to its digit string via `Value::to_text`, and sign
//! prefixes are NOT accepted (any character outside the radix digit set is
//! `#NUM!`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Results at or beyond 2^53 are `#NUM!` per the spec.
const LIMIT: f64 = 9_007_199_254_740_992.0;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let text = match ctx.eval(&args[0])?.to_text() {
        Ok(t) => t,
        Err(e) => return Ok(Value::Error(e)),
    };
    let radix = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let radix = radix.trunc();
    if !(2.0..=36.0).contains(&radix) {
        return Ok(Value::Error(CalcError::Num));
    }
    let radix = radix as u32;

    let text = text.trim();
    if text.is_empty() || text.chars().count() > 255 {
        return Ok(Value::Error(CalcError::Num));
    }
    let mut acc: f64 = 0.0;
    for c in text.chars() {
        let d = match c.to_digit(36) {
            Some(d) if d < radix => d as f64,
            _ => return Ok(Value::Error(CalcError::Num)),
        };
        acc = acc * radix as f64 + d;
        if acc >= LIMIT {
            return Ok(Value::Error(CalcError::Num));
        }
    }
    Ok(Value::Number(acc))
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
        assert_eq!(n(&eval(r#"=DECIMAL("FF",16)"#)), 255.0);
        assert_eq!(n(&eval(r#"=DECIMAL("111",2)"#)), 7.0);
        assert_eq!(n(&eval(r#"=DECIMAL("17",8)"#)), 15.0);
        assert_eq!(n(&eval(r#"=DECIMAL("FACE",16)"#)), 64206.0);
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(n(&eval(r#"=DECIMAL("ff",16)"#)), 255.0);
        assert_eq!(n(&eval(r#"=DECIMAL("zap",36)"#)), 45745.0);
    }

    #[test]
    fn radix_bounds() {
        assert_eq!(n(&eval(r#"=DECIMAL("10",2)"#)), 2.0);
        assert_eq!(n(&eval(r#"=DECIMAL("z",36)"#)), 35.0);
        assert_eq!(e(&eval(r#"=DECIMAL("10",1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=DECIMAL("10",37)"#)), CalcError::Num);
    }

    #[test]
    fn invalid_digit_for_radix() {
        assert_eq!(e(&eval(r#"=DECIMAL("2",2)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=DECIMAL("8",8)"#)), CalcError::Num);
    }

    #[test]
    fn fractional_and_sign_text() {
        // SPEC-OPEN: sign/fraction handling; treated as invalid digits.
        assert_eq!(e(&eval(r#"=DECIMAL("1.1",2)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=DECIMAL("-FF",16)"#)), CalcError::Num);
    }

    #[test]
    fn empty_text_num() {
        assert_eq!(e(&eval(r#"=DECIMAL("",16)"#)), CalcError::Num);
    }

    #[test]
    fn over_limit_num() {
        // "1" followed by 53 zeros in binary = 2^53 -> #NUM!.
        let formula = format!("=DECIMAL(\"1{}\",2)", "0".repeat(53));
        assert_eq!(e(&eval(&formula)), CalcError::Num);
        // 2^53 - 1 is representable.
        let formula = format!("=DECIMAL(\"1{}\",2)", "1".repeat(52));
        assert_eq!(n(&eval(&formula)), 9_007_199_254_740_991.0);
    }

    #[test]
    fn numeric_text_coerces() {
        // SPEC-OPEN: number coerced to digit string per to_text.
        assert_eq!(n(&eval("=DECIMAL(111,2)")), 7.0);
    }

    #[test]
    fn radix_truncates() {
        assert_eq!(n(&eval(r#"=DECIMAL("11",2.9)"#)), 3.0);
    }

    #[test]
    fn boolean_and_blank_args() {
        assert_eq!(e(&eval(r#"=DECIMAL("11",TRUE)"#)), CalcError::Num);
        assert_eq!(e(&eval("=DECIMAL(A1,2)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=DECIMAL(1/0,2)"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=DECIMAL("11",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=DECIMAL("11")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=DECIMAL("11",2,3)"#)), CalcError::Value);
    }
}
