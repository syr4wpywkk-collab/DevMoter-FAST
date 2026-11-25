//! `FV(rate, nper, pmt, [pv], [type])` — future value of an annuity
//! with constant payments and rate. Spec: `docs/functions/FV.md`.
//!
//! Closed form via [`finance::annuity_fv`]; `rate = 0` degenerates to
//! `-(pv + pmt·nper)`. Any nonzero `type` means beginning-of-period
//! payments.

use crate::common::{coercion, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let rate = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let nper = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pmt = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pv = match coercion::eval_opt_number(ctx, args.get(3), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    // Any nonzero `type` means beginning-of-period.
    let typ = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => f64::from(n != 0.0),
    };
    if rate <= -1.0 {
        // `(1+rate)` nonpositive: outside the compounding domain
        // (FV.md open question) -> #NUM!.
        return Ok(Value::Error(CalcError::Num));
    }
    let fv = finance::annuity_fv(rate, nper, pmt, pv, typ);
    if !fv.is_finite() {
        // e.g. `rate = -1` (FV.md open question) — domain failure.
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(fv))
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
    fn doc_example_begin_period() {
        let v = eval("=FV(0.06/12,10,-200,-500,1)");
        assert!((n(&v) - 2581.403374).abs() < 1e-5, "{v:?}");
    }

    #[test]
    fn doc_example_savings() {
        let v = eval("=FV(0.12/12,12,-1000)");
        assert!((n(&v) - 12682.50301).abs() < 1e-5, "{v:?}");
    }

    #[test]
    fn doc_example_retirement() {
        let v = eval("=FV(0.11/12,35,-2000,,1)");
        assert!((n(&v) - 82846.24637).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn zero_rate() {
        assert_eq!(n(&eval("=FV(0,10,-100,-500)")), 1500.0);
    }

    #[test]
    fn pv_and_pmt() {
        let v = eval("=FV(0.005,12,-100)");
        assert!((n(&v) - 1233.556237).abs() < 1e-5, "{v:?}");
    }

    #[test]
    fn pv_only_growth() {
        // -1000 at 10% for 2 periods -> 1210.
        let v = eval("=FV(0.1,2,0,-1000)");
        assert!((n(&v) - 1210.0).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn boolean_type_is_beginning() {
        assert_eq!(
            n(&eval("=FV(0.1,2,-100,0,TRUE)")),
            n(&eval("=FV(0.1,2,-100,0,1)"))
        );
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=FV(0,"10",-100,-500)"#)), 1500.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=FV("x",10,-100)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=FV(A1,10,-100)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn rate_minus_one_num() {
        assert_eq!(e(&eval("=FV(-1,10,-100)")), CalcError::Num);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FV(1,2)")), CalcError::Value);
    }
}
