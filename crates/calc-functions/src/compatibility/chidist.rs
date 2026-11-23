//! `CHIDIST(x, deg_freedom)` — legacy right-tailed chi-squared
//! probability `P(X >= x)`; equivalent to `CHISQ.DIST.RT`. Spec:
//! `docs/functions/CHIDIST.md`.
//!
//! Uses the upper regularized gamma `Q(df/2, x/2)` so the far tail
//! keeps its digits; `deg_freedom` is truncated and must lie in
//! `[1, 10^10)` per the legacy spec.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Legacy `deg_freedom` domain: `1 <= df < 10^10` after truncation.
fn valid_df(df: f64) -> bool {
    (1.0..1e10).contains(&df)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let df = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if x < 0.0 || x.is_nan() || !valid_df(df) {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = numerics::regularized_gamma_q(df / 2.0, x / 2.0);
    if v.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
    fn spec_example_df10() {
        let v = n(&eval("=CHIDIST(18.307,10)"));
        assert!((v - 0.05).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn spec_example_df2() {
        let v = n(&eval("=CHIDIST(5.991464547107979,2)"));
        assert!((v - 0.05).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn x_zero_is_one() {
        assert_eq!(n(&eval("=CHIDIST(0,5)")), 1.0);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=CHIDIST(-1,2)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=CHIDIST(2,0)")), CalcError::Num);
        // 0.9 truncates to 0.
        assert_eq!(e(&eval("=CHIDIST(2,0.9)")), CalcError::Num);
    }

    #[test]
    fn df_at_1e10_num() {
        assert_eq!(e(&eval("=CHIDIST(2,1e10)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=CHIDIST(5,4.9)"));
        let b = n(&eval("=CHIDIST(5,4)"));
        assert_eq!(a, b);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=CHIDIST("x",5)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        let v = n(&eval(r#"=CHIDIST("0",5)"#));
        assert_eq!(v, 1.0);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=CHIDIST(7.5,6)"));
        let b = n(&eval("=CHISQ.DIST.RT(7.5,6)"));
        assert_eq!(a, b);
    }
}
