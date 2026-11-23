//! `F.INV(probability, deg_freedom1, deg_freedom2)` — inverse of the
//! left-tailed F-distribution CDF. Spec: `docs/functions/F.INV.md`.
//!
//! `p` outside `[0, 1]` is `#NUM!`; `p = 1` is unbounded (`#NUM!` —
//! the spec's boundary question). `df` arguments are truncated and
//! must lie in `[1, 1e10]`; the kernel is
//! [`numerics::f_inv`] (incomplete-beta inverse).

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub(crate) fn f_inv_inner(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    right_tail: bool,
) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let p = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    let d1 = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d.trunc(),
    };
    let d2 = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d.trunc(),
    };
    if !(0.0..=1.0).contains(&p) || !(1.0..=1e10).contains(&d1) || !(1.0..=1e10).contains(&d2) {
        return Ok(Value::Error(CalcError::Num));
    }
    // Right tail: solve F_cdf(x) = 1 - p instead of p.
    let left_p = if right_tail { 1.0 - p } else { p };
    let x = numerics::f_inv(left_p, d1, d2);
    if x.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    f_inv_inner(ctx, args, false)
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
    fn spec_example_low() {
        assert!((n(&eval("=F.INV(0.01,6,4)")) - 0.10930991412457856).abs() < 1e-12);
    }

    #[test]
    fn spec_example_high() {
        assert!((n(&eval("=F.INV(0.99,6,4)")) - 15.206864861157523).abs() < 1e-9);
    }

    #[test]
    fn median_f11() {
        // F(1,1) median is 1 (Cauchy ratio symmetry).
        assert!((n(&eval("=F.INV(0.5,1,1)")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn classic_table_value() {
        // F-table: upper 5% point of F(6,4) is 6.1631.
        assert!((n(&eval("=F.INV(0.95,6,4)")) - 6.163132282688632).abs() < 1e-9);
    }

    #[test]
    fn p_zero_gives_zero() {
        assert_eq!(n(&eval("=F.INV(0,6,4)")), 0.0);
    }

    #[test]
    fn p_one_is_num() {
        // Unbounded upper tail -> #NUM! (spec open question).
        assert_eq!(e(&eval("=F.INV(1,6,4)")), CalcError::Num);
    }

    #[test]
    fn negative_p_num() {
        assert_eq!(e(&eval("=F.INV(-0.5,6,4)")), CalcError::Num);
    }

    #[test]
    fn p_above_one_num() {
        assert_eq!(e(&eval("=F.INV(1.5,6,4)")), CalcError::Num);
    }

    #[test]
    fn df_zero_num() {
        assert_eq!(e(&eval("=F.INV(0.5,0,4)")), CalcError::Num);
        assert_eq!(e(&eval("=F.INV(0.5,6,0)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        assert_eq!(n(&eval("=F.INV(0.5,1,1)")), n(&eval("=F.INV(0.5,1.9,1.9)")));
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=F.INV(\"x\",6,4)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=F.INV(A1,6,4)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=F.INV(0.5,6)")), CalcError::Value);
    }
}
