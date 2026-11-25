//! `ODDLYIELD(settlement, maturity, last_interest, rate, pr,
//! redemption, frequency, [basis])` — yield of a security with an odd
//! last coupon period. Spec: `docs/functions/ODDLYIELD.md`.
//!
//! Kernel: [`finance::oddl_yield`] — the documented closed form (no
//! iteration required).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (settlement, maturity, last_interest, rate, pr, redemption, frequency, basis) =
        match super::oddlprice::eval_args(ctx, args)? {
            Ok(t) => t,
            Err(e) => return Ok(Value::Error(e)),
        };
    if pr <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match finance::oddl_yield(
        settlement,
        maturity,
        last_interest,
        rate,
        pr,
        redemption,
        frequency,
        basis,
        ctx.date_system(),
    ) {
        Some(v) if v.is_finite() => Ok(Value::Number(v)),
        _ => Ok(Value::Error(CalcError::Num)),
    }
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
        // MS doc example: settlement 2008-04-20, maturity 2008-06-15,
        // last coupon 2007-12-24, pr 99.875 -> 0.045192.
        let v = eval(
            "=ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,2,0)",
        );
        assert!((n(&v) - 0.045192).abs() < 1e-5, "{v:?}");
    }

    #[test]
    fn round_trip() {
        // ODDLYIELD(ODDLPRICE(y)) == y.
        let p = eval(
            "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)",
        );
        let y = eval(&format!(
            "=ODDLYIELD(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,{},100,2,0)",
            n(&p)
        ));
        assert!((n(&y) - 0.0405).abs() < 1e-9, "{y:?}");
    }

    #[test]
    fn ordering_num() {
        let v =
            eval("=ODDLYIELD(DATE(2007,10,15),DATE(2008,6,15),DATE(2007,10,15),0.0375,99,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_rate_num() {
        let v =
            eval("=ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),-0.05,99.875,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn zero_price_num() {
        let v = eval("=ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,0,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_frequency_num() {
        let v = eval(
            "=ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,3)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval(
            "=ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,2,9)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn discount_price_positive_yield() {
        // Price below par -> positive yield.
        let v =
            eval("=ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,90,100,2)");
        assert!(n(&v) > 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(r#"=ODDLYIELD("x",DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,2)"#);
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=ODDLYIELD(A1,DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ODDLYIELD(1,2,3,4,5,6)")), CalcError::Value);
    }
}
