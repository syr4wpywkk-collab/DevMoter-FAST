//! `PERMUTATIONA(number, number_chosen)` — permutations with
//! repetition `= n^k`. Spec: `docs/functions/PERMUTATIONA.md`.

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
    if n < 0.0 || k < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let result = n.powf(k);
    // n^k with integer n,k is always finite-or-overflow; non-finite
    // (only +inf possible here) maps to #NUM! (SPEC-OPEN: overflow kind).
    if result.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    if result.is_infinite() {
        return Ok(Value::Error(CalcError::Num));
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
        assert_eq!(n(&eval("=PERMUTATIONA(3,2)")), 9.0);
        assert_eq!(n(&eval("=PERMUTATIONA(10,3)")), 1000.0);
    }

    #[test]
    fn k_gt_n_allowed() {
        assert_eq!(n(&eval("=PERMUTATIONA(5,7)")), 78125.0);
    }

    #[test]
    fn k_zero_is_one() {
        assert_eq!(n(&eval("=PERMUTATIONA(2,0)")), 1.0);
    }

    #[test]
    fn zero_zero_is_one() {
        // Excel: PERMUTATIONA(0,0) = 1.
        assert_eq!(n(&eval("=PERMUTATIONA(0,0)")), 1.0);
    }

    #[test]
    fn n_zero_k_positive() {
        assert_eq!(n(&eval("=PERMUTATIONA(0,3)")), 0.0);
    }

    #[test]
    fn truncates_args() {
        assert_eq!(n(&eval("=PERMUTATIONA(3.9,2.9)")), 9.0);
    }

    #[test]
    fn negatives_num() {
        assert_eq!(e(&eval("=PERMUTATIONA(-3,2)")), CalcError::Num);
        assert_eq!(e(&eval("=PERMUTATIONA(3,-2)")), CalcError::Num);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=PERMUTATIONA(1E+200,2)")), CalcError::Num);
    }

    #[test]
    fn text_value() {
        assert_eq!(e(&eval("=PERMUTATIONA(\"x\",2)")), CalcError::Value);
        assert_eq!(e(&eval("=PERMUTATIONA(3,\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=PERMUTATIONA(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[("A1", 3.0.into()), ("B1", 2.0.into())],
            "=PERMUTATIONA(A1,B1)",
        );
        assert_eq!(n(&v), 9.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=PERMUTATIONA(3)")), CalcError::Value);
    }
}
