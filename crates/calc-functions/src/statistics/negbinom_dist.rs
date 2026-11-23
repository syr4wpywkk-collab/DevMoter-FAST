//! `NEGBINOM.DIST(number_f, number_s, probability_s, cumulative)` —
//! negative binomial: probability of `number_f` failures before the
//! `number_s`-th success. Spec: `docs/functions/NEGBINOM.DIST.md`.
//!
//! PMF `= C(f+s-1, s-1) · p^s · (1-p)^f`; CDF `= I_p(s, f+1)`
//! ([`numerics::regularized_beta`]).

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
    let mut nums = [0.0; 3];
    for (i, slot) in nums.iter_mut().enumerate() {
        *slot = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [f, s, p] = [nums[0].trunc(), nums[1].trunc(), nums[2]];
    if f < 0.0 || s < 1.0 || !(0.0..=1.0).contains(&p) {
        return Ok(Value::Error(CalcError::Num));
    }
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let out = if cumulative {
        numerics::regularized_beta(p, s, f + 1.0)
    } else if p == 0.0 {
        0.0 // s >= 1 -> p^s = 0
    } else if p == 1.0 {
        if f == 0.0 { 1.0 } else { 0.0 }
    } else {
        (numerics::ln_choose(f + s - 1.0, s - 1.0) + s * p.ln() + f * (1.0 - p).ln()).exp()
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
        assert!((n(&eval("=NEGBINOM.DIST(10,5,0.25,FALSE)")) - 0.05504866).abs() < 1e-7);
    }

    #[test]
    fn doc_example_cdf() {
        assert!((n(&eval("=NEGBINOM.DIST(10,5,0.25,TRUE)")) - 0.313514058).abs() < 1e-7);
    }

    #[test]
    fn zero_failures() {
        // C(0,0) * p^1 = p.
        assert!((n(&eval("=NEGBINOM.DIST(0,1,0.5,FALSE)")) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn truncation() {
        assert_eq!(
            n(&eval("=NEGBINOM.DIST(10.9,5.9,0.25,FALSE)")),
            n(&eval("=NEGBINOM.DIST(10,5,0.25,FALSE)"))
        );
    }

    #[test]
    fn cdf_monotone() {
        let a = n(&eval("=NEGBINOM.DIST(10,5,0.25,TRUE)"));
        let b = n(&eval("=NEGBINOM.DIST(11,5,0.25,TRUE)"));
        assert!(b > a && b <= 1.0);
    }

    #[test]
    fn p_one_degenerate() {
        // All mass on f = 0.
        assert_eq!(n(&eval("=NEGBINOM.DIST(0,3,1,FALSE)")), 1.0);
        assert_eq!(n(&eval("=NEGBINOM.DIST(5,3,1,FALSE)")), 0.0);
        assert_eq!(n(&eval("=NEGBINOM.DIST(5,3,1,TRUE)")), 1.0);
    }

    #[test]
    fn f_negative_num() {
        assert_eq!(e(&eval("=NEGBINOM.DIST(-1,5,0.25,FALSE)")), CalcError::Num);
    }

    #[test]
    fn s_below_one_num() {
        assert_eq!(e(&eval("=NEGBINOM.DIST(10,0,0.25,FALSE)")), CalcError::Num);
        assert_eq!(
            e(&eval("=NEGBINOM.DIST(10,0.5,0.25,FALSE)")),
            CalcError::Num
        );
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=NEGBINOM.DIST(10,5,-0.1,FALSE)")), CalcError::Num);
        assert_eq!(e(&eval("=NEGBINOM.DIST(10,5,1.1,FALSE)")), CalcError::Num);
    }

    #[test]
    fn text_value() {
        assert_eq!(
            e(&eval("=NEGBINOM.DIST(\"x\",5,0.25,FALSE)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval("=NEGBINOM.DIST(10,5,0.25,\"x\")")),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=NEGBINOM.DIST(1/0,5,0.25,FALSE)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[("A1", 10.0.into()), ("B1", 5.0.into()), ("C1", 0.25.into())],
            "=NEGBINOM.DIST(A1,B1,C1,TRUE)",
        );
        assert!((n(&v) - 0.313514058).abs() < 1e-7);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=NEGBINOM.DIST(10,5,0.25)")), CalcError::Value);
    }
}
