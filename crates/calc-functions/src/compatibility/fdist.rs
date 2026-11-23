//! `FDIST(x, deg_freedom1, deg_freedom2)` — legacy right-tailed F
//! probability `P(X >= x)`; equivalent to `F.DIST.RT`. Spec:
//! `docs/functions/FDIST.md`.
//!
//! Computed as `I_{1-z}(df2/2, df1/2)` at `z = df1·x/(df1·x + df2)` so
//! the far tail is not lost to `1 - CDF` cancellation. Both df are
//! truncated and must lie in `[1, 10^10)` per the legacy spec.

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
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let df1 = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let df2 = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if x < 0.0 || x.is_nan() || !valid_df(df1) || !valid_df(df2) {
        return Ok(Value::Error(CalcError::Num));
    }
    let z = df1 * x / (df1 * x + df2);
    let v = numerics::regularized_beta(1.0 - z, df2 / 2.0, df1 / 2.0);
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
    fn spec_example_1pct() {
        let v = n(&eval("=FDIST(15.20686486,6,4)"));
        assert!((v - 0.01).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn spec_example_f45() {
        // Spec doc prints 0.100438 "approx"; the exact tail is
        // I_{5/13}(5/2,1) = (5/13)^(5/2) = 0.0917416...
        let v = n(&eval("=FDIST(4,2,5)"));
        assert!((v - 0.09174166759556843).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn x_zero_is_one() {
        assert_eq!(n(&eval("=FDIST(0,5,5)")), 1.0);
    }

    #[test]
    fn median_f11() {
        let v = n(&eval("=FDIST(1,1,1)"));
        assert!((v - 0.5).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=FDIST(-1,5,5)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=FDIST(2,0,5)")), CalcError::Num);
        assert_eq!(e(&eval("=FDIST(2,5,0.9)")), CalcError::Num);
    }

    #[test]
    fn df_at_1e10_num() {
        assert_eq!(e(&eval("=FDIST(2,1e10,5)")), CalcError::Num);
        assert_eq!(e(&eval("=FDIST(2,5,1e10)")), CalcError::Num);
    }

    #[test]
    fn df_truncated() {
        let a = n(&eval("=FDIST(2,4.9,5)"));
        let b = n(&eval("=FDIST(2,4,5)"));
        assert_eq!(a, b);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=FDIST("x",5,5)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerced() {
        assert_eq!(n(&eval(r#"=FDIST("0",5,5)"#)), 1.0);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=FDIST(2.5,6,8)"));
        let b = n(&eval("=F.DIST.RT(2.5,6,8)"));
        assert_eq!(a, b);
    }
}
