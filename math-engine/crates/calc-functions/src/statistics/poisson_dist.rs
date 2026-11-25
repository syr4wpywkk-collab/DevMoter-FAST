//! `POISSON.DIST(x, mean, cumulative)` — Poisson distribution.
//! PMF via `ln_poisson_pmf`; CDF via the regularized gamma identity
//! `P(X <= x) = Q(x+1, mean)`. Spec: `docs/functions/POISSON.DIST.md`.

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
        assert!((n(&eval("=POISSON.DIST(2,5,FALSE)")) - 0.084224337).abs() < 1e-7);
    }

    #[test]
    fn doc_example_cdf() {
        assert!((n(&eval("=POISSON.DIST(2,5,TRUE)")) - 0.124652019).abs() < 1e-7);
    }

    #[test]
    fn x_zero() {
        assert!((n(&eval("=POISSON.DIST(0,1,FALSE)")) - 0.36787944117144233).abs() < 1e-15);
        assert!(
            (n(&eval("=POISSON.DIST(0,1,TRUE)")) - n(&eval("=POISSON.DIST(0,1,FALSE)"))).abs()
                < 1e-14
        );
    }

    #[test]
    fn x_truncates() {
        assert_eq!(
            n(&eval("=POISSON.DIST(2.9,5,FALSE)")),
            n(&eval("=POISSON.DIST(2,5,FALSE)"))
        );
    }

    #[test]
    fn cdf_monotone() {
        let a = n(&eval("=POISSON.DIST(3,5,TRUE)"));
        let b = n(&eval("=POISSON.DIST(4,5,TRUE)"));
        assert!(b > a && b <= 1.0);
    }

    #[test]
    fn cdf_tail_near_one() {
        assert!((n(&eval("=POISSON.DIST(30,5,TRUE)")) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn x_negative_num() {
        assert_eq!(e(&eval("=POISSON.DIST(-1,5,FALSE)")), CalcError::Num);
    }

    #[test]
    fn mean_zero_num() {
        assert_eq!(e(&eval("=POISSON.DIST(0,0,FALSE)")), CalcError::Num);
        assert_eq!(e(&eval("=POISSON.DIST(0,-1,FALSE)")), CalcError::Num);
    }

    #[test]
    fn cumulative_numeric_coercion() {
        assert_eq!(
            n(&eval("=POISSON.DIST(2,5,1)")),
            n(&eval("=POISSON.DIST(2,5,TRUE)"))
        );
    }

    #[test]
    fn text_value() {
        assert_eq!(e(&eval("=POISSON.DIST(\"x\",5,FALSE)")), CalcError::Value);
        assert_eq!(e(&eval("=POISSON.DIST(2,5,\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=POISSON.DIST(1/0,5,FALSE)")), CalcError::DivZero);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("B1", 5.0.into())],
            "=POISSON.DIST(A1,B1,FALSE)",
        );
        assert!((n(&v) - 0.084224337).abs() < 1e-7);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=POISSON.DIST(2,5)")), CalcError::Value);
    }
}
