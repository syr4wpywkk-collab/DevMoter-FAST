//! `GAMMADIST(x, alpha, beta, cumulative)` — legacy gamma
//! distribution PDF/CDF with shape `alpha` and scale `beta`;
//! equivalent to `GAMMA.DIST`. Spec: `docs/functions/GAMMADIST.md`.
//!
//! PDF `= x^(a-1) e^(-x/b) / (b^a Γ(a))` in log space; CDF `= P(a,
//! x/b)` via [`numerics::regularized_gamma_p`]. `x < 0`, `alpha <= 0`
//! or `beta <= 0` -> `#NUM!`; non-numeric -> `#VALUE!`.

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
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let [x, alpha, beta] = nums;
    if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    if cumulative {
        let p = numerics::regularized_gamma_p(alpha, x / beta);
        if p.is_nan() {
            return Ok(Value::Error(CalcError::Num));
        }
        return Ok(Value::Number(p));
    }
    // PDF in log space; x = 0: alpha > 1 -> 0, alpha == 1 -> 1/beta,
    // alpha < 1 -> infinite density -> #NUM!.
    if x == 0.0 {
        if alpha > 1.0 {
            return Ok(Value::Number(0.0));
        }
        if alpha == 1.0 {
            return Ok(Value::Number(1.0 / beta));
        }
        return Ok(Value::Error(CalcError::Num));
    }
    let ln_pdf = (alpha - 1.0) * x.ln() - x / beta - alpha * beta.ln() - numerics::ln_gamma(alpha);
    let pdf = ln_pdf.exp();
    if !pdf.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(pdf))
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
    fn spec_example_pdf() {
        let v = n(&eval("=GAMMADIST(10,9,2,FALSE)"));
        assert!((v - 0.032639).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn spec_example_cdf() {
        let v = n(&eval("=GAMMADIST(10,9,2,TRUE)"));
        assert!((v - 0.068094).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn alpha_one_is_exponential() {
        // 1 - e^-1
        let v = n(&eval("=GAMMADIST(1,1,1,TRUE)"));
        assert!((v - 0.632120559).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn pdf_at_zero() {
        assert_eq!(n(&eval("=GAMMADIST(0,2,2,FALSE)")), 0.0);
        assert_eq!(n(&eval("=GAMMADIST(0,1,2,FALSE)")), 0.5);
    }

    #[test]
    fn cdf_at_zero() {
        assert_eq!(n(&eval("=GAMMADIST(0,9,2,TRUE)")), 0.0);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=GAMMADIST(-1,9,2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_alpha_num() {
        assert_eq!(e(&eval("=GAMMADIST(1,0,2,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMADIST(1,-1,2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_beta_num() {
        assert_eq!(e(&eval("=GAMMADIST(1,9,0,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMADIST(1,9,-2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn cumulative_numeric_zero_is_false() {
        let v = n(&eval("=GAMMADIST(10,9,2,0)"));
        assert!((v - 0.032639).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=GAMMADIST("x",9,2,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=GAMMADIST(4,3,1.5,FALSE)"));
        let b = n(&eval("=GAMMA.DIST(4,3,1.5,FALSE)"));
        assert_eq!(a, b);
    }
}
