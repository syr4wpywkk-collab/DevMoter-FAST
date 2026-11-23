//! `HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop,
//! cumulative)` — hypergeometric PMF/CDF. Spec:
//! `docs/functions/HYPGEOM.DIST.md`.
//!
//! Integer parameters are truncated. `k` below the lower support bound
//! `max(0, n - (N - M))` yields `0` for both PMF and CDF (the spec's
//! support question); `k < 0` or `k > min(n, M)` is `#NUM!`. The PMF
//! is computed in log space via [`numerics::ln_choose`].

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn ln_pmf(k: f64, n: f64, m: f64, big_n: f64) -> f64 {
    numerics::ln_choose(m, k) + numerics::ln_choose(big_n - m, n - k)
        - numerics::ln_choose(big_n, n)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 5, 5) {
        return Ok(Value::Error(e));
    }
    let k = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let n = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let m = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let big_n = match coercion::eval_number(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    let cumulative = match ctx.eval(&args[4])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    // Domain bounds per the spec; each `#NUM!` condition documented.
    if big_n <= 0.0 || m < 0.0 || m > big_n || n <= 0.0 || n > big_n {
        return Ok(Value::Error(CalcError::Num));
    }
    let hi = n.min(m);
    if k < 0.0 || k > hi {
        return Ok(Value::Error(CalcError::Num));
    }
    let lo = (n - (big_n - m)).max(0.0);
    if k < lo {
        // Below the support: probability is exactly zero.
        return Ok(Value::Number(0.0));
    }
    if !cumulative {
        return Ok(Value::Number(ln_pmf(k, n, m, big_n).exp()));
    }
    let mut acc = 0.0;
    let mut i = lo;
    while i <= k {
        acc += ln_pmf(i, n, m, big_n).exp();
        i += 1.0;
    }
    Ok(Value::Number(acc.min(1.0)))
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
    fn spec_pmf() {
        // C(8,1)·C(12,3)/C(20,4) = 1760/4845.
        assert!((n(&eval("=HYPGEOM.DIST(1,4,8,20,FALSE)")) - 0.3632610939112487).abs() < 1e-14);
    }

    #[test]
    fn spec_cdf() {
        assert!((n(&eval("=HYPGEOM.DIST(1,4,8,20,TRUE)")) - 0.4654282765737874).abs() < 1e-13);
    }

    #[test]
    fn spec_pmf_zero() {
        assert!((n(&eval("=HYPGEOM.DIST(0,4,8,20,FALSE)")) - 0.10216718266253871).abs() < 1e-14);
    }

    #[test]
    fn k_above_min_is_num() {
        assert_eq!(e(&eval("=HYPGEOM.DIST(9,4,8,20,FALSE)")), CalcError::Num);
    }

    #[test]
    fn n_above_pop_is_num() {
        assert_eq!(e(&eval("=HYPGEOM.DIST(1,4,8,3,FALSE)")), CalcError::Num);
    }

    #[test]
    fn negative_k_num() {
        assert_eq!(e(&eval("=HYPGEOM.DIST(-1,4,8,20,FALSE)")), CalcError::Num);
    }

    #[test]
    fn m_out_of_range_num() {
        assert_eq!(e(&eval("=HYPGEOM.DIST(1,4,25,20,FALSE)")), CalcError::Num);
        assert_eq!(e(&eval("=HYPGEOM.DIST(1,4,-1,20,FALSE)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_pop_num() {
        assert_eq!(e(&eval("=HYPGEOM.DIST(1,4,8,0,FALSE)")), CalcError::Num);
    }

    #[test]
    fn below_support_gives_zero() {
        // Drawing 18 from a population of 20 with 5 successes must
        // yield at least 3 successes: P(X<=2) = 0.
        assert_eq!(n(&eval("=HYPGEOM.DIST(2,18,5,20,FALSE)")), 0.0);
        assert_eq!(n(&eval("=HYPGEOM.DIST(2,18,5,20,TRUE)")), 0.0);
    }

    #[test]
    fn integers_truncated() {
        assert_eq!(
            n(&eval("=HYPGEOM.DIST(1,4,8,20,FALSE)")),
            n(&eval("=HYPGEOM.DIST(1.9,4.9,8.9,20.9,FALSE)"))
        );
    }

    #[test]
    fn cumulative_sums_to_one() {
        // k at the top of the support: CDF = 1.
        assert!((n(&eval("=HYPGEOM.DIST(4,4,8,20,TRUE)")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn large_population_no_overflow() {
        // Log-space PMF: C(N,n) can overflow in linear form.
        let v = eval("=HYPGEOM.DIST(5,20,30,100,FALSE)");
        assert!((n(&v) - 0.1918255924290466).abs() < 1e-13);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(
            e(&eval("=HYPGEOM.DIST(\"x\",4,8,20,FALSE)")),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=HYPGEOM.DIST(A1,4,8,20,FALSE)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
