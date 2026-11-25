//! `SYD(cost, salvage, life, per)` — sum-of-years'-digits
//! depreciation for period `per`:
//! `(cost - salvage) * (life - per + 1) * 2 / (life * (life + 1))`.
//! Spec: `docs/functions/SYD.md`.
//!
//! `life` and `per` are truncated toward zero like the `DB`/`DDB`
//! family (SPEC-OPEN: fractional-argument truncation is not
//! explicitly documented for SYD). `per > life` or `per < 1` is
//! `#NUM!` (SPEC-OPEN: some references return `0`/no error for
//! `per > life`).

use crate::common::date_serial;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::arg_num;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let cost = match arg_num(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let salvage = match arg_num(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let life = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => date_serial::trunc_to_i64(v),
    };
    let per = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => date_serial::trunc_to_i64(v),
    };
    if life <= 0 || per < 1 || per > life {
        return Ok(Value::Error(CalcError::Num));
    }
    let (life, per) = (life as f64, per as f64);
    Ok(Value::Number(
        (cost - salvage) * (life - per + 1.0) * 2.0 / (life * (life + 1.0)),
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
    fn spec_first_period() {
        // 22500 * 10/55.
        let got = n(&eval("=SYD(30000,7500,10,1)"));
        assert!((got - 4090.9090909).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn spec_last_period() {
        // 22500 * 1/55.
        let got = n(&eval("=SYD(30000,7500,10,10)"));
        assert!((got - 409.0909091).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn spec_mid_period() {
        // 10000 * 3/10.
        assert_eq!(n(&eval("=SYD(10000,0,4,2)")), 3000.0);
    }

    #[test]
    fn per_beyond_life_num() {
        // SPEC-OPEN: per > life assumed #NUM! per spec doc.
        assert_eq!(e(&eval("=SYD(10000,0,4,5)")), CalcError::Num);
    }

    #[test]
    fn per_zero_num() {
        assert_eq!(e(&eval("=SYD(10000,0,4,0)")), CalcError::Num);
    }

    #[test]
    fn life_zero_num() {
        assert_eq!(e(&eval("=SYD(10000,0,0,1)")), CalcError::Num);
    }

    #[test]
    fn life_negative_num() {
        assert_eq!(e(&eval("=SYD(10000,0,-4,1)")), CalcError::Num);
    }

    #[test]
    fn total_depreciation_sums_to_basis() {
        // Sum over all periods = cost - salvage.
        let sum: f64 = (1..=5)
            .map(|p| n(&eval(&format!("=SYD(9000,1000,5,{p})"))))
            .sum();
        assert!((sum - 8000.0).abs() < 1e-9, "got {sum}");
    }

    #[test]
    fn fractional_per_truncates() {
        // per = 1.9 truncates to 1 (SPEC-OPEN: truncation assumed).
        assert_eq!(
            n(&eval("=SYD(10000,0,4,1.9)")),
            n(&eval("=SYD(10000,0,4,1)"))
        );
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=SYD(10000,0,4,"x")"#)), CalcError::Value);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=SYD(10000,0,"4",2)"#)), 3000.0);
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=SYD(10000,0,4,A1)");
        assert_eq!(e(&v), CalcError::NA);
    }
}
