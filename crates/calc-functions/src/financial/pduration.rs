//! `PDURATION(rate, pv, fv)` — periods for `pv` to grow to `fv` at
//! `rate` per period (no payments). Spec: `docs/functions/PDURATION.md`.
//!
//! `ln(fv/pv) / ln(1+rate)`; all arguments must be positive, any
//! nonpositive argument -> `#NUM!`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let rate = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pv = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let fv = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    if rate <= 0.0 || pv <= 0.0 || fv <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((fv / pv).ln() / rate.ln_1p()))
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
    fn doc_example() {
        let v = eval("=PDURATION(0.025,1000,2000)");
        assert!((n(&v) - 28.0710).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn exact_one_period() {
        assert!((n(&eval("=PDURATION(0.1,100,110)")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn equal_pv_fv_is_zero() {
        assert_eq!(n(&eval("=PDURATION(0.05,100,100)")), 0.0);
    }

    #[test]
    fn negative_rate_num() {
        // Rate <= 0 -> #NUM! even when fv < pv would solve (PDURATION.md).
        assert_eq!(e(&eval("=PDURATION(-0.1,100,50)")), CalcError::Num);
    }

    #[test]
    fn zero_rate_num() {
        assert_eq!(e(&eval("=PDURATION(0,100,200)")), CalcError::Num);
    }

    #[test]
    fn zero_pv_num() {
        assert_eq!(e(&eval("=PDURATION(0.05,0,200)")), CalcError::Num);
    }

    #[test]
    fn zero_fv_num() {
        assert_eq!(e(&eval("=PDURATION(0.05,100,0)")), CalcError::Num);
    }

    #[test]
    fn fractional_periods() {
        let v = eval("=PDURATION(0.1,100,105)");
        assert!(n(&v) > 0.0 && n(&v) < 1.0);
    }

    #[test]
    fn shrinking_investment() {
        // fv < pv gives a negative period count.
        assert!(n(&eval("=PDURATION(0.05,200,100)")) < 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=PDURATION("x",100,200)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=PDURATION(0.05,A1,200)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=PDURATION(0.05,100)")), CalcError::Value);
    }
}
