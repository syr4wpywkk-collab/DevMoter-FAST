//! `NOMINAL(effect_rate, npery)` — nominal annual rate from the
//! effective rate and compounding periods per year.
//! Spec: `docs/functions/NOMINAL.md`.
//!
//! `npery·((1 + effect)^(1/npery) - 1)`; `npery` truncates to integer.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let effect = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let npery = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc(),
    };
    if effect <= 0.0 || npery < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(
        npery * ((1.0 + effect).powf(1.0 / npery) - 1.0),
    ))
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
    fn doc_example_inverts_effect() {
        let v = eval("=NOMINAL(0.053542667,4)");
        assert!((n(&v) - 0.0525).abs() < 1e-7, "{v:?}");
    }

    #[test]
    fn doc_example_quarterly() {
        let v = eval("=NOMINAL(0.0625,4)");
        assert!((n(&v) - 0.06108637).abs() < 1e-7, "{v:?}");
    }

    #[test]
    fn annual_compounding_identity() {
        assert!((n(&eval("=NOMINAL(0.1,1)")) - 0.1).abs() < 1e-12);
    }

    #[test]
    fn doc_example_monthly() {
        let v = eval("=NOMINAL(0.051161898,12)");
        assert!((n(&v) - 0.05).abs() < 1e-7, "{v:?}");
    }

    #[test]
    fn zero_effect_num() {
        assert_eq!(e(&eval("=NOMINAL(0,4)")), CalcError::Num);
    }

    #[test]
    fn negative_effect_num() {
        assert_eq!(e(&eval("=NOMINAL(-0.05,4)")), CalcError::Num);
    }

    #[test]
    fn npery_below_one_num() {
        assert_eq!(e(&eval("=NOMINAL(0.05,0)")), CalcError::Num);
        assert_eq!(e(&eval("=NOMINAL(0.05,0.9)")), CalcError::Num);
    }

    #[test]
    fn npery_truncates() {
        assert_eq!(
            n(&eval("=NOMINAL(0.0625,4.9)")),
            n(&eval("=NOMINAL(0.0625,4)"))
        );
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=NOMINAL("x",4)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=NOMINAL(A1,4)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=NOMINAL(0.05)")), CalcError::Value);
    }
}
