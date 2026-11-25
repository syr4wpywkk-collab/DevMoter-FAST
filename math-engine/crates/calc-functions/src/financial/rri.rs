//! `RRI(nper, pv, fv)` — equivalent constant growth rate taking `pv`
//! to `fv` in `nper` periods: `(fv/pv)^(1/nper) - 1`.
//! Spec: `docs/functions/RRI.md`.
//!
//! Closed form; may be negative when `fv < pv`. All three arguments
//! must be strictly positive (Excel reports `#NUM!` otherwise —
//! documented behavior).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::arg_num;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let mut vals = [0.0; 3];
    for (i, v) in vals.iter_mut().enumerate() {
        *v = match arg_num(ctx, args, i)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [nper, pv, fv] = vals;
    if nper <= 0.0 || pv <= 0.0 || fv <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((fv / pv).powf(1.0 / nper) - 1.0))
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
    fn doubling_ten_years() {
        // 2^(1/10) - 1.
        let got = n(&eval("=RRI(10,1000,2000)"));
        assert!((got - 0.0717735).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn negative_growth() {
        // (0.5)^(1/5) - 1.
        let got = n(&eval("=RRI(5,1000,500)"));
        assert!((got - (-0.1294494)).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn one_period() {
        let got = n(&eval("=RRI(1,100,110)"));
        assert!((got - 0.1).abs() < 1e-12, "got {got}");
    }

    #[test]
    fn fractional_nper() {
        let got = n(&eval("=RRI(2.5,100,200)"));
        assert!((got - (2.0f64.powf(0.4) - 1.0)).abs() < 1e-12, "got {got}");
    }

    #[test]
    fn no_growth_zero() {
        assert_eq!(n(&eval("=RRI(10,100,100)")), 0.0);
    }

    #[test]
    fn nper_zero_num() {
        assert_eq!(e(&eval("=RRI(0,100,200)")), CalcError::Num);
    }

    #[test]
    fn nper_negative_num() {
        assert_eq!(e(&eval("=RRI(-3,100,200)")), CalcError::Num);
    }

    #[test]
    fn pv_negative_num() {
        assert_eq!(e(&eval("=RRI(10,-100,200)")), CalcError::Num);
    }

    #[test]
    fn fv_zero_num() {
        assert_eq!(e(&eval("=RRI(10,100,0)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=RRI(10,"x",200)"#)), CalcError::Value);
    }

    #[test]
    fn text_number_coerces() {
        let got = n(&eval(r#"=RRI("10",1000,2000)"#));
        assert!((got - 0.0717735).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Ref))], "=RRI(10,A1,200)");
        assert_eq!(e(&v), CalcError::Ref);
    }
}
