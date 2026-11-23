//! `COMBINA(number, number_chosen)` — combinations **with repetition**:
//! `C(n+k-1, k)`. Spec: `docs/functions/COMBINA.md`.
//!
//! Arguments truncate toward zero; `n < 0` or `k < 0` -> `#NUM!`.
//! `k > n` is allowed. `n = 0` edge (SPEC-OPEN): documented result is
//! `1` for `COMBINA(0,0)`; `COMBINA(0,k>0)` returns `0` here pending
//! empirical confirmation.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

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
    if !n.is_finite() || !k.is_finite() || n < 0.0 || k < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    if n == 0.0 {
        // SPEC-OPEN: C(-1,k) is undefined mathematically; documented
        // Excel result for COMBINA(0,0) is 1, and 0 for k > 0.
        return Ok(Value::Number(if k == 0.0 { 1.0 } else { 0.0 }));
    }
    // C(n+k-1, k); n >= 1 so n+k-1 >= k >= 0 always holds.
    let top = n + k - 1.0;
    if top >= 9.007_199_254_740_992e15 {
        return Ok(Value::Error(CalcError::Num));
    }
    let r = super::combin::binomial(top as u64, k as u64);
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
        assert_eq!(n(&eval("=COMBINA(4,3)")), 20.0);
        assert_eq!(n(&eval("=COMBINA(10,3)")), 220.0);
        assert_eq!(n(&eval("=COMBINA(2,5)")), 6.0);
    }

    #[test]
    fn k_greater_than_n_allowed() {
        assert_eq!(n(&eval("=COMBINA(3,10)")), 66.0);
    }

    #[test]
    fn k_zero() {
        assert_eq!(n(&eval("=COMBINA(4,0)")), 1.0);
    }

    #[test]
    fn n_zero_edge() {
        // SPEC-OPEN documented values.
        assert_eq!(n(&eval("=COMBINA(0,0)")), 1.0);
        assert_eq!(n(&eval("=COMBINA(0,3)")), 0.0);
    }

    #[test]
    fn truncation() {
        assert_eq!(n(&eval("=COMBINA(4.9,3.9)")), 20.0);
    }

    #[test]
    fn num_errors() {
        assert_eq!(e(&eval("=COMBINA(-1,2)")), CalcError::Num);
        assert_eq!(e(&eval("=COMBINA(4,-1)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=COMBINA("4","3")"#)), 20.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COMBINA("x",3)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=COMBINA(4,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_and_blank() {
        assert_eq!(n(&eval("=COMBINA(TRUE,TRUE)")), 1.0);
        assert_eq!(n(&eval("=COMBINA(A1,B1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COMBINA(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COMBINA(4)")), CalcError::Value);
        assert_eq!(e(&eval("=COMBINA(4,3,1)")), CalcError::Value);
    }
}
