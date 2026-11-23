//! `F.DIST(x, deg_freedom1, deg_freedom2, cumulative)` — left-tailed F
//! distribution. Spec: `docs/functions/F.DIST.md`.
//!
//! CDF = `I_z(df1/2, df2/2)` at `z = df1·x/(df1·x + df2)`; the PDF is
//! evaluated in log space:
//! `ln f = a·ln(df1/df2) + (a-1)·ln x - (a+b)·ln(1 + df1·x/df2)
//! - ln B(a,b)` with `a = df1/2`, `b = df2/2`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// `z = df1·x / (df1·x + df2)`: the beta-domain transform of `x`.
pub(crate) fn f_to_z(x: f64, df1: f64, df2: f64) -> f64 {
    df1 * x / (df1 * x + df2)
}

/// F CDF `P(X <= x)` at `x >= 0`.
pub(crate) fn f_cdf(x: f64, df1: f64, df2: f64) -> f64 {
    numerics::regularized_beta(f_to_z(x, df1, df2), df1 / 2.0, df2 / 2.0)
}

/// F right tail `P(X >= x)` — complementary incomplete beta so the
/// tail does not collapse through `1 - CDF`.
pub(crate) fn f_rt(x: f64, df1: f64, df2: f64) -> f64 {
    numerics::regularized_beta(1.0 - f_to_z(x, df1, df2), df2 / 2.0, df1 / 2.0)
}

/// F density at `x >= 0` (edge limits handled).
fn f_pdf(x: f64, df1: f64, df2: f64) -> f64 {
    let (a, b) = (df1 / 2.0, df2 / 2.0);
    if x == 0.0 {
        return if a < 1.0 {
            f64::INFINITY
        } else if a == 1.0 {
            // f(0) = (df1/df2)^a / B(a,b) when a = 1.
            let ln_beta = numerics::ln_gamma(a) + numerics::ln_gamma(b) - numerics::ln_gamma(a + b);
            (a * (df1 / df2).ln() - ln_beta).exp()
        } else {
            0.0
        };
    }
    let ln_beta = numerics::ln_gamma(a) + numerics::ln_gamma(b) - numerics::ln_gamma(a + b);
    (a * (df1 / df2).ln() + (a - 1.0) * x.ln() - (a + b) * (1.0 + df1 * x / df2).ln() - ln_beta)
        .exp()
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
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
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    if x < 0.0
        || x.is_nan()
        || !super::chisq_dist::valid_df(df1)
        || !super::chisq_dist::valid_df(df2)
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = if cumulative {
        f_cdf(x, df1, df2)
    } else {
        f_pdf(x, df1, df2)
    };
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
    fn cdf_spec_example_99pct() {
        let v = n(&eval("=F.DIST(15.20686486,6,4,TRUE)"));
        assert!((v - 0.99).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn pdf_spec_example() {
        let v = n(&eval("=F.DIST(15.20686486,6,4,FALSE)"));
        assert!((v - 0.0012237997101687897).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn spec_example_median() {
        // I_{0.5}(0.5, 0.5) = 0.5
        assert_eq!(n(&eval("=F.DIST(1,1,1,TRUE)")), 0.5);
    }

    #[test]
    fn negative_x_is_num() {
        assert_eq!(e(&eval("=F.DIST(-1,2,3,TRUE)")), CalcError::Num);
    }

    #[test]
    fn df_zero_is_num() {
        assert_eq!(e(&eval("=F.DIST(1,0,3,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=F.DIST(1,2,0,TRUE)")), CalcError::Num);
    }

    #[test]
    fn df_above_bound_is_num() {
        assert_eq!(e(&eval("=F.DIST(1,1E11,3,TRUE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=F.DIST("x",2,3,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn cdf_at_zero() {
        assert_eq!(n(&eval("=F.DIST(0,2,3,TRUE)")), 0.0);
    }

    #[test]
    fn truncates_df() {
        let a = n(&eval("=F.DIST(2,4.9,9.9,TRUE)"));
        let b = n(&eval("=F.DIST(2,4,9,TRUE)"));
        assert_eq!(a, b);
    }

    #[test]
    fn cdf_monotone() {
        let a = n(&eval("=F.DIST(1,3,10,TRUE)"));
        let b = n(&eval("=F.DIST(3,3,10,TRUE)"));
        assert!(a < b && b < 1.0);
    }

    #[test]
    fn pdf_positive() {
        let v = n(&eval("=F.DIST(1,5,10,FALSE)"));
        assert!(v > 0.0 && v < 1.0, "got {v}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=F.DIST(1/0,2,3,TRUE)")), CalcError::DivZero);
    }
}
