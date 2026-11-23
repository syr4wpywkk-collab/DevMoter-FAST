//! `POISSON(x, mean, cumulative)` — legacy Poisson distribution.
//! Spec: `docs/functions/POISSON.md`.
//!
//! Identical signature to `POISSON.DIST`: PMF via
//! [`numerics::ln_poisson_pmf`], CDF via the regularized-gamma
//! identity `P(X <= x) = Q(x+1, mean)`. `x` truncated; `x < 0` or
//! `mean <= 0` -> `#NUM!` (the `mean = 0` boundary is a recorded
//! spec open question — the non-positive check follows
//! `POISSON.DIST`).

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let mean = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let cumulative = match ctx.eval(&args[2])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    if x < 0.0 || mean <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let out = if cumulative {
        numerics::regularized_gamma_q(x + 1.0, mean)
    } else {
        numerics::ln_poisson_pmf(x, mean).exp()
    };
    Ok(Value::Number(out))
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
    fn doc_example_pmf() {
        // Excel doc: POISSON(2,5,FALSE) = 0.084224.
        assert!((n(&eval("=POISSON(2,5,FALSE)")) - 0.084224337).abs() < 1e-7);
    }

    #[test]
    fn doc_example_cdf() {
        // Excel doc: POISSON(2,5,TRUE) = 0.124652.
        assert!((n(&eval("=POISSON(2,5,TRUE)")) - 0.124652019).abs() < 1e-7);
    }

    #[test]
    fn zero_events_pmf() {
        // e^-5
        assert!((n(&eval("=POISSON(0,5,FALSE)")) - 0.006737947).abs() < 1e-9);
    }

    #[test]
    fn zero_events_cdf_equals_pmf() {
        let c = n(&eval("=POISSON(0,5,TRUE)"));
        let p = n(&eval("=POISSON(0,5,FALSE)"));
        assert!((c - p).abs() < 1e-15, "{c} vs {p}");
    }

    #[test]
    fn matches_poisson_dist() {
        assert_eq!(
            n(&eval("=POISSON(3,2.4,TRUE)")),
            n(&eval("=POISSON.DIST(3,2.4,TRUE)"))
        );
    }

    #[test]
    fn truncates_x() {
        assert_eq!(
            n(&eval("=POISSON(2.9,5,FALSE)")),
            n(&eval("=POISSON(2,5,FALSE)"))
        );
    }

    #[test]
    fn cdf_ge_pmf() {
        let c = n(&eval("=POISSON(3,4,TRUE)"));
        let p = n(&eval("=POISSON(3,4,FALSE)"));
        assert!(c > p);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=POISSON(-1,5,FALSE)")), CalcError::Num);
        // -0.5 truncates to 0 -> still valid.
        assert!(n(&eval("=POISSON(-0.5,5,FALSE)")) > 0.0);
    }

    #[test]
    fn nonpositive_mean_num() {
        assert_eq!(e(&eval("=POISSON(2,-1,FALSE)")), CalcError::Num);
        assert_eq!(e(&eval("=POISSON(2,0,FALSE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=POISSON(\"x\",5,FALSE)")), CalcError::Value);
        assert_eq!(e(&eval("=POISSON(2,\"x\",FALSE)")), CalcError::Value);
    }

    #[test]
    fn text_and_bool_coercion() {
        assert!((n(&eval("=POISSON(\"2\",5,FALSE)")) - 0.084224337).abs() < 1e-7);
        assert_eq!(n(&eval("=POISSON(2,5,TRUE)")), n(&eval("=POISSON(2,5,1)")));
    }

    #[test]
    fn large_mean_no_overflow() {
        // Log-space PMF keeps x=100, mean=100 finite.
        let v = n(&eval("=POISSON(100,100,FALSE)"));
        assert!((v - 0.0398609).abs() < 1e-5, "got {v}");
    }
}
