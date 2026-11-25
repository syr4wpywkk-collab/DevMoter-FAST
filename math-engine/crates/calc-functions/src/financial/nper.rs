//! `NPER(rate, pmt, pv, [fv], [type])` — number of periods for an
//! annuity with constant payment. Spec: `docs/functions/NPER.md`.
//!
//! Closed form: solving `pv·(1+r)ⁿ + pmt·(1+r·type)·((1+r)ⁿ-1)/r + fv
//! = 0` gives `(1+r)ⁿ = (pmt·c - fv·r)/(pv·r + pmt·c)` with
//! `c = 1+r·type`. `rate = 0` degenerates to `-(pv+fv)/pmt`.
//! A nonpositive ratio or `rate <= -1` has no real solution -> `#NUM!`.

use crate::common::coercion;
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
    let pmt = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pv = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let fv = match coercion::eval_opt_number(ctx, args.get(3), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let typ = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => f64::from(n != 0.0),
    };
    let n = if rate == 0.0 {
        if pmt == 0.0 {
            // 0/0 degenerate (NPER.md open question: #NUM! chosen).
            return Ok(Value::Error(CalcError::Num));
        }
        -(pv + fv) / pmt
    } else {
        let c = 1.0 + rate * typ;
        let ratio = (pmt * c - fv * rate) / (pv * rate + pmt * c);
        if ratio <= 0.0 || rate <= -1.0 {
            return Ok(Value::Error(CalcError::Num));
        }
        ratio.ln() / rate.ln_1p()
    };
    if !n.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(n))
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
    fn doc_example_payoff() {
        // 10,000 at 0.5%/mo paying 200/mo: 57.68 periods.
        let v = eval("=NPER(0.005,-200,10000)");
        assert!((n(&v) - 57.6801).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn doc_example_growth() {
        // -5,000 today receiving 150/mo: crosses zero at ~36.56.
        let v = eval("=NPER(0.005,150,-5000)");
        assert!((n(&v) - 36.5559).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn zero_rate() {
        assert_eq!(n(&eval("=NPER(0,-100,1200)")), 12.0);
    }

    #[test]
    fn payment_too_small_num() {
        // Payment below interest accrual never pays off.
        assert_eq!(e(&eval("=NPER(0.005,-50,10000)")), CalcError::Num);
    }

    #[test]
    fn zero_rate_zero_pmt_num() {
        assert_eq!(e(&eval("=NPER(0,0,1200)")), CalcError::Num);
    }

    #[test]
    fn with_fv_target() {
        // Loan with balloon: FV at the solved period count hits fv.
        let np = n(&eval("=NPER(0.005,-200,10000,-5000)"));
        let fv = eval(&format!("=FV(0.005,{np},-200,10000)"));
        // FV returns the fv argument's sign convention: -5000 owed.
        assert!((n(&fv) - -5000.0).abs() < 1e-6, "{fv:?}");
    }

    #[test]
    fn begin_of_period() {
        let v = eval("=NPER(0.005,-200,10000,0,1)");
        assert!(n(&v) < 57.68, "{v:?}");
        assert!(n(&v) > 50.0);
    }

    #[test]
    fn rate_minus_one_num() {
        assert_eq!(e(&eval("=NPER(-1,-200,10000)")), CalcError::Num);
    }

    #[test]
    fn fractional_result() {
        // Excel does not round up.
        let v = eval("=NPER(0.005,-200,10000)");
        assert!((n(&v) - n(&v).round()).abs() > 1e-6);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=NPER("x",-200,10000)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=NPER(0.005,A1,10000)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=NPER(0.005,-200)")), CalcError::Value);
    }
}
