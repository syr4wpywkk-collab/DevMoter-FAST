//! `CHISQ.DIST(x, deg_freedom, cumulative)` — left-tailed chi-squared
//! PDF/CDF. Spec: `docs/functions/CHISQ.DIST.md`.
//!
//! CDF = `P(df/2, x/2)` ([`numerics::regularized_gamma_p`]); PDF in
//! log space so extreme `df` never overflow the gamma ratio.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Documented `deg_freedom` domain for the `CHISQ.*`/`F.*` functions:
/// `1 <= df <= 10^10` after truncation.
pub(crate) fn valid_df(df: f64) -> bool {
    (1.0..=1e10).contains(&df)
}

/// Chi-squared CDF `P(X <= x)` at `x >= 0`.
pub(crate) fn chisq_cdf(x: f64, df: f64) -> f64 {
    numerics::regularized_gamma_p(df / 2.0, x / 2.0)
}

/// Chi-squared right tail `P(X >= x)` at `x >= 0`.
pub(crate) fn chisq_rt(x: f64, df: f64) -> f64 {
    numerics::regularized_gamma_q(df / 2.0, x / 2.0)
}

/// Chi-squared density at `x >= 0` (edge limits handled).
pub(crate) fn chisq_pdf(x: f64, df: f64) -> f64 {
    let a = df / 2.0;
    if x == 0.0 {
        return if a < 1.0 {
            f64::INFINITY
        } else if a == 1.0 {
            0.5
        } else {
            0.0
        };
    }
    ((a - 1.0) * x.ln() - x / 2.0 - a * std::f64::consts::LN_2 - numerics::ln_gamma(a)).exp()
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
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
    let cumulative = match ctx.eval(&args[2])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    if x < 0.0 || x.is_nan() || !valid_df(df) {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = if cumulative {
        chisq_cdf(x, df)
    } else {
        chisq_pdf(x, df)
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
    fn cdf_spec_example_df1() {
        let v = n(&eval("=CHISQ.DIST(0.5,1,TRUE)"));
        assert!((v - 0.5204998778130465).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn pdf_spec_example() {
        let v = n(&eval("=CHISQ.DIST(2,3,FALSE)"));
        assert!((v - 0.20755374871029736).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn cdf_95th_pct_df10() {
        let v = n(&eval("=CHISQ.DIST(18.307,10,TRUE)"));
        assert!((v - 0.95).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn negative_x_is_num() {
        assert_eq!(e(&eval("=CHISQ.DIST(-1,3,TRUE)")), CalcError::Num);
    }

    #[test]
    fn df_zero_is_num() {
        assert_eq!(e(&eval("=CHISQ.DIST(2,0,TRUE)")), CalcError::Num);
    }

    #[test]
    fn df_above_bound_is_num() {
        assert_eq!(e(&eval("=CHISQ.DIST(2,1E11,TRUE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=CHISQ.DIST("x",3,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn truncates_df() {
        let a = n(&eval("=CHISQ.DIST(2,3.9,FALSE)"));
        let b = n(&eval("=CHISQ.DIST(2,3,FALSE)"));
        assert_eq!(a, b);
    }

    #[test]
    fn cdf_at_zero() {
        assert_eq!(n(&eval("=CHISQ.DIST(0,3,TRUE)")), 0.0);
    }

    #[test]
    fn pdf_at_zero_df2() {
        // chi2 df=2 density at 0 is 1/2.
        assert_eq!(n(&eval("=CHISQ.DIST(0,2,FALSE)")), 0.5);
    }

    #[test]
    fn cdf_monotone_in_x() {
        let a = n(&eval("=CHISQ.DIST(3,4,TRUE)"));
        let b = n(&eval("=CHISQ.DIST(6,4,TRUE)"));
        assert!(a < b && b < 1.0);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CHISQ.DIST(1/0,3,TRUE)")), CalcError::DivZero);
    }
}
