//! `PERMUT(number, number_chosen)` — permutations `P(n,k) = n!/(n-k)!`
//! without repetition. Spec: `docs/functions/PERMUT.md`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let n = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let k = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if n <= 0.0 || k < 0.0 || k > n {
        return Ok(Value::Error(CalcError::Num));
    }
    // Multiply n·(n-1)·…·(n-k+1) directly — no factorial blow-up.
    let mut result = 1.0f64;
    for i in 0..(k as u64) {
        result *= n - i as f64;
        if !result.is_finite() {
            // SPEC-OPEN (PERMUT.md): Excel's overflow error assumed `#NUM!`.
            return Ok(Value::Error(CalcError::Num));
        }
    }
    Ok(Value::Number(result))
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
    fn doc_examples() {
        assert_eq!(n(&eval("=PERMUT(100,3)")), 970200.0);
        assert_eq!(n(&eval("=PERMUT(10,10)")), 3628800.0);
    }

    #[test]
    fn k_zero_is_one() {
        assert_eq!(n(&eval("=PERMUT(5,0)")), 1.0);
    }

    #[test]
    fn truncates_args() {
        assert_eq!(n(&eval("=PERMUT(100.9,3.9)")), 970200.0);
    }

    #[test]
    fn k_gt_n_num() {
        assert_eq!(e(&eval("=PERMUT(5,6)")), CalcError::Num);
    }

    #[test]
    fn n_zero_num() {
        assert_eq!(e(&eval("=PERMUT(0,0)")), CalcError::Num);
        assert_eq!(e(&eval("=PERMUT(-3,2)")), CalcError::Num);
    }

    #[test]
    fn k_negative_num() {
        assert_eq!(e(&eval("=PERMUT(5,-1)")), CalcError::Num);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=PERMUT(1E+300,200)")), CalcError::Num);
    }

    #[test]
    fn text_value() {
        assert_eq!(e(&eval("=PERMUT(\"x\",2)")), CalcError::Value);
        assert_eq!(e(&eval("=PERMUT(5,\"x\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(n(&eval("=PERMUT(\"100\",\"3\")")), 970200.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=PERMUT(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[("A1", 100.0.into()), ("B1", 3.0.into())],
            "=PERMUT(A1,B1)",
        );
        assert_eq!(n(&v), 970200.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=PERMUT(5)")), CalcError::Value);
    }
}
