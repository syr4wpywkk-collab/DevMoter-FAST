//! `HYPGEOMDIST(sample_s, number_sample, population_s, number_pop)` —
//! legacy hypergeometric point probability (no cumulative argument);
//! equivalent to `HYPGEOM.DIST(..., FALSE)`. Spec:
//! `docs/functions/HYPGEOMDIST.md`.
//!
//! All four arguments are truncated. Unlike the modern form, `sample_s`
//! below the support bound `max(0, n - N + M)` is `#NUM!` per the
//! legacy spec, and `population_s <= 0` is `#NUM!`. The PMF is
//! computed in log space via [`numerics::ln_choose`].

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
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
    // Legacy domain bounds per the spec.
    if big_n <= 0.0 || m <= 0.0 || m > big_n || n <= 0.0 || n > big_n {
        return Ok(Value::Error(CalcError::Num));
    }
    let lo = (n - (big_n - m)).max(0.0);
    let hi = n.min(m);
    if k < lo || k > hi {
        return Ok(Value::Error(CalcError::Num));
    }
    let ln_p = numerics::ln_choose(m, k) + numerics::ln_choose(big_n - m, n - k)
        - numerics::ln_choose(big_n, n);
    let p = ln_p.exp();
    if p.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(p))
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
    fn spec_example() {
        // 8*C(12,3)/C(20,4) = 1760/4845.
        let v = n(&eval("=HYPGEOMDIST(1,4,8,20)"));
        assert!((v - 0.363261).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn spec_example_zero_successes() {
        // C(12,4)/C(20,4) = 495/4845 = 0.102167... (spec doc's
        // printed 0.102253 is slightly off).
        let v = n(&eval("=HYPGEOMDIST(0,4,8,20)"));
        assert!((v - 0.10216718266253857).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn k_above_sample_num() {
        assert_eq!(e(&eval("=HYPGEOMDIST(5,4,8,20)")), CalcError::Num);
    }

    #[test]
    fn negative_pop_num() {
        assert_eq!(e(&eval("=HYPGEOMDIST(1,4,8,-20)")), CalcError::Num);
    }

    #[test]
    fn k_below_support_num() {
        // n - (N - M) = 9 - 2 = 7; k = 5 < 7 -> #NUM!.
        assert_eq!(e(&eval("=HYPGEOMDIST(5,9,8,10)")), CalcError::Num);
    }

    #[test]
    fn k_negative_num() {
        assert_eq!(e(&eval("=HYPGEOMDIST(-1,4,8,20)")), CalcError::Num);
    }

    #[test]
    fn population_s_zero_num() {
        assert_eq!(e(&eval("=HYPGEOMDIST(0,4,0,20)")), CalcError::Num);
    }

    #[test]
    fn sample_above_pop_num() {
        assert_eq!(e(&eval("=HYPGEOMDIST(1,25,8,20)")), CalcError::Num);
    }

    #[test]
    fn sample_s_above_population_s_num() {
        assert_eq!(e(&eval("=HYPGEOMDIST(9,10,8,20)")), CalcError::Num);
    }

    #[test]
    fn truncation() {
        // 1.9 -> 1.
        let a = n(&eval("=HYPGEOMDIST(1.9,4,8,20)"));
        let b = n(&eval("=HYPGEOMDIST(1,4,8,20)"));
        assert_eq!(a, b);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=HYPGEOMDIST("x",4,8,20)"#)), CalcError::Value);
    }

    #[test]
    fn matches_modern_pmf() {
        let a = n(&eval("=HYPGEOMDIST(2,5,10,30)"));
        let b = n(&eval("=HYPGEOM.DIST(2,5,10,30,FALSE)"));
        assert_eq!(a, b);
    }
}
