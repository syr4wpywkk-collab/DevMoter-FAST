//! `COMBIN(number, number_chosen)` — binomial coefficient `C(n, k)`.
//! Spec: `docs/functions/COMBIN.md`.
//!
//! Both arguments truncate toward zero; `n < 0`, `k < 0` or `k > n`
//! -> `#NUM!`. Computed multiplicatively so `COMBIN(2000,2)` does not
//! overflow through `n!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Multiplicative binomial coefficient `C(n, k)` for `n >= k >= 0`.
/// Returns a non-finite value if the exact result overflows `f64`
/// (caller maps to `#NUM!`). Exact while the running product stays
/// below 2^53; rounded to the nearest integer for larger results.
pub(crate) fn binomial(n: u64, k: u64) -> f64 {
    let k = k.min(n - k);
    let mut r = 1.0f64;
    for i in 1..=k {
        r = r * (n - k + i) as f64 / i as f64;
        // Keep intermediate values near the true C(n-k+i, i), which is
        // always an integer: rounding early limits f64 drift.
        if r < 9.007_199_254_740_992e15 {
            r = r.round();
        }
    }
    r
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let n = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let k = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n = n.trunc();
    let k = k.trunc();
    if !(n.is_finite() && k.is_finite())
        || n < 0.0
        || k < 0.0
        || k > n
        || n >= 9.007_199_254_740_992e15
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let r = binomial(n as u64, k as u64);
    if !r.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(r.round()))
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
        assert_eq!(n(&eval("=COMBIN(8,2)")), 28.0);
        assert_eq!(n(&eval("=COMBIN(8,3)")), 56.0);
        assert_eq!(n(&eval("=COMBIN(4.9,1)")), 4.0);
    }

    #[test]
    fn edge_k_zero() {
        assert_eq!(n(&eval("=COMBIN(8,0)")), 1.0);
        assert_eq!(n(&eval("=COMBIN(0,0)")), 1.0);
    }

    #[test]
    fn k_equals_n() {
        assert_eq!(n(&eval("=COMBIN(8,8)")), 1.0);
    }

    #[test]
    fn truncation() {
        assert_eq!(n(&eval("=COMBIN(8.9,2.9)")), 28.0);
    }

    #[test]
    fn large_no_factorial_overflow() {
        assert_eq!(n(&eval("=COMBIN(2000,2)")), 1_999_000.0);
    }

    #[test]
    fn symmetry() {
        assert_eq!(n(&eval("=COMBIN(10,3)")), n(&eval("=COMBIN(10,7)")));
    }

    #[test]
    fn num_errors() {
        assert_eq!(e(&eval("=COMBIN(-1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=COMBIN(8,-1)")), CalcError::Num);
        assert_eq!(e(&eval("=COMBIN(3,5)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=COMBIN("8","2")"#)), 28.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COMBIN("x",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=COMBIN(8,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_and_blank() {
        assert_eq!(n(&eval("=COMBIN(TRUE,TRUE)")), 1.0);
        // Blank refs coerce to 0.
        assert_eq!(n(&eval("=COMBIN(A1,B1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COMBIN(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COMBIN(8)")), CalcError::Value);
        assert_eq!(e(&eval("=COMBIN(8,2,1)")), CalcError::Value);
    }
}
