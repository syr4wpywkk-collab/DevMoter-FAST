//! `TDIST(x, deg_freedom, tails)` — legacy Student's t tail
//! probability. Spec: `docs/functions/TDIST.md`.
//!
//! Legacy constraints differ from `T.DIST`: `x` must be `>= 0` and
//! `tails` is a required `1|2` argument (truncated). `tails=1` is
//! `T.DIST.RT`, `tails=2` is `T.DIST.2T` — both via
//! [`numerics::t_sf`]. Truncation of `tails` (e.g. `1.9` -> `1`) is
//! a recorded spec open question, matched to `T.TEST`'s convention.

use crate::common::{numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let x = match statistics::scalar_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let df = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc(),
    };
    let tails = match statistics::scalar_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc() as i64,
    };
    if x < 0.0 || df < 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let p1 = numerics::t_sf(x, df);
    Ok(Value::Number(match tails {
        1 => p1,
        2 => (2.0 * p1).min(1.0),
        _ => return Ok(Value::Error(CalcError::Num)),
    }))
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
    fn doc_example_two_tail() {
        // Excel doc: TDIST(1.959999998,60,2) = 0.054645.
        let v = n(&eval("=TDIST(1.959999998,60,2)"));
        assert!((v - 0.054644926).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn doc_example_one_tail() {
        let v = n(&eval("=TDIST(1.959999998,60,1)"));
        assert!((v - 0.027322463).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn x_zero_is_one() {
        assert_eq!(n(&eval("=TDIST(0,10,2)")), 1.0);
        assert!((n(&eval("=TDIST(0,10,1)")) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn one_tail_half_of_two() {
        let a = n(&eval("=TDIST(2,10,1)"));
        let b = n(&eval("=TDIST(2,10,2)"));
        assert!((2.0 * a - b).abs() < 1e-15);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=TDIST(-1,10,2)")), CalcError::Num);
    }

    #[test]
    fn df_below_one_num() {
        assert_eq!(e(&eval("=TDIST(1,0.9,2)")), CalcError::Num);
    }

    #[test]
    fn tails_not_one_or_two_num() {
        assert_eq!(e(&eval("=TDIST(1,10,3)")), CalcError::Num);
        assert_eq!(e(&eval("=TDIST(1,10,0)")), CalcError::Num);
    }

    #[test]
    fn tails_truncates() {
        assert_eq!(n(&eval("=TDIST(1,10,1.9)")), n(&eval("=TDIST(1,10,1)")));
    }

    #[test]
    fn df_truncates() {
        assert_eq!(n(&eval("=TDIST(1,10.9,2)")), n(&eval("=TDIST(1,10,2)")));
    }

    #[test]
    fn matches_t_dist_2t_and_rt() {
        assert_eq!(n(&eval("=TDIST(1.5,20,2)")), n(&eval("=T.DIST.2T(1.5,20)")));
        assert_eq!(n(&eval("=TDIST(1.5,20,1)")), n(&eval("=T.DIST.RT(1.5,20)")));
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=TDIST(\"x\",10,2)")), CalcError::Value);
        assert_eq!(e(&eval("=TDIST(1,\"x\",2)")), CalcError::Value);
        assert_eq!(e(&eval("=TDIST(1,10,\"x\")")), CalcError::Value);
    }

    #[test]
    fn round_trip_tinv() {
        let x = n(&eval("=TINV(0.05,10)"));
        let p = n(&eval(&format!("=TDIST({x},10,2)")));
        assert!((p - 0.05).abs() < 1e-9);
    }
}
