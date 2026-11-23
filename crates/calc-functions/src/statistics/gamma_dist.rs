//! `GAMMA.DIST(x, alpha, beta, cumulative)` — gamma PDF/CDF with shape
//! `alpha` and scale `beta`. Spec: `docs/functions/GAMMA.DIST.md`.
//!
//! PDF `= x^(a-1) e^(-x/b) / (b^a Γ(a))`, CDF `= P(a, x/b)` via
//! [`crate::common::numerics::regularized_gamma_p`]. Domain errors:
//! `x < 0`, `alpha <= 0`, `beta <= 0` -> `#NUM!`; non-numeric ->
//! `#VALUE!`. `cumulative` follows direct scalar-boolean coercion.

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
    fn spec_pdf_example() {
        let v = n(&eval("=GAMMA.DIST(10.00001131,9,2,FALSE)"));
        assert!((v - 0.03263913041829395).abs() < 1e-13, "got {v}");
    }

    #[test]
    fn spec_cdf_example() {
        let v = n(&eval("=GAMMA.DIST(10.00001131,9,2,TRUE)"));
        assert!((v - 0.0680940038697872).abs() < 1e-13, "got {v}");
    }

    #[test]
    fn closed_form_cdf() {
        // P(2, 2) = 1 - 3e^-2
        let v = n(&eval("=GAMMA.DIST(4,2,2,TRUE)"));
        assert!((v - 0.5939941502901619).abs() < 1e-13);
    }

    #[test]
    fn exponential_pdf() {
        // alpha=1, beta=1: pdf(1) = e^-1
        let v = n(&eval("=GAMMA.DIST(1,1,1,FALSE)"));
        assert!((v - std::f64::consts::E.recip()).abs() < 1e-15);
    }

    #[test]
    fn x_zero_alpha_one() {
        // Exponential pdf at 0 = 1/beta.
        assert_eq!(n(&eval("=GAMMA.DIST(0,1,2,FALSE)")), 0.5);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=GAMMA.DIST(-1,1,1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn zero_alpha_num() {
        assert_eq!(e(&eval("=GAMMA.DIST(1,0,1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn negative_beta_num() {
        assert_eq!(e(&eval("=GAMMA.DIST(1,1,-2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=GAMMA.DIST("a",1,1,TRUE)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=GAMMA.DIST(1,"a",1,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn cumulative_numeric_coerces() {
        // 0 -> FALSE (pdf), 1 -> TRUE (cdf).
        let pdf = n(&eval("=GAMMA.DIST(4,2,2,0)"));
        let cdf = n(&eval("=GAMMA.DIST(4,2,2,1)"));
        assert!((cdf - 0.5939941502901619).abs() < 1e-13);
        assert!(pdf < cdf);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 2.0.into()), ("A3", 2.0.into())],
            "=GAMMA.DIST(A1,A2,A3,TRUE)",
        );
        assert!((n(&v) - 0.5939941502901619).abs() < 1e-13);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref))],
            "=GAMMA.DIST(A1,1,1,TRUE)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=GAMMA.DIST(1,1,1)")), CalcError::Value);
        assert_eq!(e(&eval("=GAMMA.DIST(1,1,1,TRUE,1)")), CalcError::Value);
    }
}
