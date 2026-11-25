//! `PPMT(rate, per, nper, pv, [fv], [type])` — principal portion of
//! the payment in period `per`. Spec: `docs/functions/PPMT.md`.
//!
//! `PPMT = PMT(...) - IPMT(...)`; `per`/`nper` truncate to integers.

use crate::common::coercion;
use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 6) {
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
    let fv = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let typ = match coercion::eval_opt_number(ctx, args.get(5), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => f64::from(n != 0.0),
    };
    let (per, nper) = (per.trunc(), nper.trunc());
    if per < 1.0 || per > nper {
        return Ok(Value::Error(CalcError::Num));
    }
    let pmt = finance::annuity_pmt(rate, nper, pv, fv, typ);
    let v = pmt - super::ipmt::interest(rate, per, nper, pv, fv, typ);
    if !v.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
        // PMT ≈ -1627.454, period-1 interest = 1000.
        let v = eval("=PPMT(0.1,1,10,10000)");
        assert!((n(&v) - -627.4540).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn doc_example_last_period() {
        // Final period repays the outstanding balance:
        // |PMT|/1.1 = 1627.4539/1.1 = 1479.5036.
        let v = eval("=PPMT(0.1,10,10,10000)");
        assert!((n(&v) - -1479.5036).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn doc_example_monthly() {
        // PMT -304.219 minus period-1 interest 50.
        let v = eval("=PPMT(0.005,1,36,10000)");
        assert!((n(&v) - -254.2194).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn per_zero_num() {
        assert_eq!(e(&eval("=PPMT(0.1,0,10,10000)")), CalcError::Num);
    }

    #[test]
    fn per_beyond_nper_num() {
        assert_eq!(e(&eval("=PPMT(0.1,11,10,10000)")), CalcError::Num);
    }

    #[test]
    fn begin_period_first_is_all_principal() {
        let pmt = n(&eval("=PMT(0.1,10,10000,0,1)"));
        let v = eval("=PPMT(0.1,1,10,10000,0,1)");
        assert!((n(&v) - pmt).abs() < 1e-9, "{v:?} vs {pmt}");
    }

    #[test]
    fn principal_sums_to_pv() {
        // Zero rate: sum of principal portions equals -pv.
        let mut sum = 0.0;
        for k in 1..=10 {
            sum += n(&eval(&format!("=PPMT(0,{k},10,10000)")));
        }
        assert!((sum - -10000.0).abs() < 1e-9);
    }

    #[test]
    fn fractional_per_truncates() {
        assert_eq!(
            n(&eval("=PPMT(0.1,1.9,10,10000)")),
            n(&eval("=PPMT(0.1,1,10,10000)"))
        );
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=PPMT("x",1,10,10000)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=PPMT(0.1,A1,10,10000)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=PPMT(0.1,1,10)")), CalcError::Value);
    }
}
