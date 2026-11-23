//! `F.INV.RT(probability, deg_freedom1, deg_freedom2)` — inverse of
//! the right-tailed F probability, `= F.INV(1 - p, df1, df2)`.
//! Spec: `docs/functions/F.INV.RT.md`.
//!
//! Shares the argument/domain handling in [`super::f_inv`]; only the
//! tail differs.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    super::f_inv::f_inv_inner(ctx, args, true)
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
    fn spec_example_upper() {
        // Right-tail 1% of F(6,4) is the left-tail 99% point.
        assert!((n(&eval("=F.INV.RT(0.01,6,4)")) - 15.206864861157523).abs() < 1e-9);
    }

    #[test]
    fn spec_example_lower() {
        assert!((n(&eval("=F.INV.RT(0.99,6,4)")) - 0.10930991412457856).abs() < 1e-12);
    }

    #[test]
    fn median_f11() {
        assert!((n(&eval("=F.INV.RT(0.5,1,1)")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn p_one_gives_zero() {
        // Right-tail probability 1 -> x = 0.
        assert_eq!(n(&eval("=F.INV.RT(1,6,4)")), 0.0);
    }

    #[test]
    fn p_zero_is_num() {
        // Right-tail 0 -> +inf -> #NUM!.
        assert_eq!(e(&eval("=F.INV.RT(0,6,4)")), CalcError::Num);
    }

    #[test]
    fn p_above_one_num() {
        assert_eq!(e(&eval("=F.INV.RT(1.5,6,4)")), CalcError::Num);
    }

    #[test]
    fn negative_p_num() {
        assert_eq!(e(&eval("=F.INV.RT(-0.1,6,4)")), CalcError::Num);
    }

    #[test]
    fn df_out_of_range_num() {
        assert_eq!(e(&eval("=F.INV.RT(0.5,0,4)")), CalcError::Num);
        assert_eq!(e(&eval("=F.INV.RT(0.5,6,0)")), CalcError::Num);
        assert_eq!(e(&eval("=F.INV.RT(0.5,1e11,4)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        assert_eq!(
            n(&eval("=F.INV.RT(0.5,1,1)")),
            n(&eval("=F.INV.RT(0.5,1.9,1.9)"))
        );
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=F.INV.RT(\"x\",6,4)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=F.INV.RT(A1,6,4)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=F.INV.RT(0.5,6)")), CalcError::Value);
    }
}
