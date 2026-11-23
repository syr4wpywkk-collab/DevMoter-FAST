//! `ISPMT(rate, per, nper, pv)` — interest paid in period `per` of a
//! loan with **equal principal** repayments.
//! Spec: `docs/functions/ISPMT.md`.
//!
//! `pv·rate·(per - nper)/nper`; `per` is **0-based** (unlike `IPMT`).
//! `nper = 0` -> `#DIV/0!`. Out-of-range `per` still evaluates
//! (extrapolation, per ISPMT.md).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let rate = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let per = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let nper = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pv = match coercion::eval_number(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    if nper == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(pv * rate * (per / nper - 1.0)))
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
    fn doc_example_first_period() {
        // 0-based: per 0 has the full balance outstanding.
        let v = eval("=ISPMT(0.1/12,0,36,8000000)");
        assert!((n(&v) - -66666.66667).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn doc_example_second_period() {
        let v = eval("=ISPMT(0.1/12,1,36,8000000)");
        assert!((n(&v) - -64814.81481).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn doc_example_third_period() {
        let v = eval("=ISPMT(0.1/12,2,36,8000000)");
        assert!((n(&v) - -62962.96296).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn last_period_interest() {
        // per = nper-1: only one principal slice outstanding.
        let v = eval("=ISPMT(0.1/12,35,36,8000000)");
        assert!((n(&v) - -1851.851852).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn nper_zero_div0() {
        assert_eq!(e(&eval("=ISPMT(0.1/12,1,0,8000000)")), CalcError::DivZero);
    }

    #[test]
    fn zero_rate_is_zero() {
        assert_eq!(n(&eval("=ISPMT(0,0,36,8000000)")), 0.0);
    }

    #[test]
    fn negative_pv_positive_interest() {
        assert!(n(&eval("=ISPMT(0.1,0,10,-1000)")) > 0.0);
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=ISPMT(0,0,"36",8000000)"#)), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ISPMT("x",0,36,8000)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=ISPMT(A1,0,36,8000)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISPMT(0.1,0,36)")), CalcError::Value);
    }
}
