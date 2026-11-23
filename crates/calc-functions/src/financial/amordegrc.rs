//! `AMORDEGRC(cost, date_purchased, first_period, salvage, period,
//! rate, [basis])` — French declining-balance depreciation with a
//! life-dependent acceleration coefficient. Spec:
//! `docs/functions/AMORDEGRC.md`.
//!
//! Mirrors the reference algorithm (LibreOffice `GetAmordegrc`):
//! - `life = 1/rate` selects the coefficient: `<3 -> 1.0`,
//!   `<5 -> 1.5`, `<=6 -> 2.0`, else `2.5` (the spec's "exact rounding"
//!   open question is resolved toward the reference rule);
//! - the effective rate is `rate * coefficient`;
//! - period 0 is `round(yearfrac * eff_rate * cost)` — every period's
//!   depreciation IS rounded to an integer;
//! - each later period is `round(eff_rate * remaining_book)`, walking
//!   the book value down; when the residual `remaining - salvage`
//!   would go negative, the last two periods split the book value in
//!   half each (`round(book/2)`) and periods beyond return 0.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::finance;

use super::amor_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let a = match amor_args(ctx, args)? {
        Ok(a) => a,
        Err(e) => return Ok(Value::Error(e)),
    };
    let life = 1.0 / a.rate;
    let coeff = if life < 3.0 {
        1.0
    } else if life < 5.0 {
        1.5
    } else if life <= 6.0 {
        2.0
    } else {
        2.5
    };
    let eff_rate = a.rate * coeff;
    let yf = match finance::year_fraction(a.purchased, a.first_period, a.basis, a.system) {
        Some(yf) => yf,
        None => return Ok(Value::Error(calc_core::error::CalcError::Num)),
    };
    let mut nrate = (yf * eff_rate * a.cost).round();
    if a.period == 0 {
        return Ok(Value::Number(nrate));
    }
    let mut cost = a.cost - nrate;
    let mut rest = cost - a.salvage;
    let mut result = nrate;
    for n in 0..a.period {
        nrate = (eff_rate * cost).round();
        if nrate == 0.0 {
            // The book value stops decaying; no further depreciation
            // (guards against an unbounded loop on huge `period`).
            return Ok(Value::Number(0.0));
        }
        rest -= nrate;
        if rest < 0.0 {
            return Ok(Value::Number(if a.period - n <= 1 {
                (cost * 0.5).round()
            } else {
                0.0
            }));
        }
        cost -= nrate;
        result = nrate;
    }
    Ok(Value::Number(result))
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

    const F: &str = "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300";

    #[test]
    fn spec_examples() {
        // rate 15% -> life 6.67y -> coeff 2.5 -> eff rate 37.5%.
        assert_eq!(n(&eval(&format!("{F},1,0.15,1)"))), 776.0);
        // Period 0: round(2400*0.375*134/366) = round(329.51) = 330.
        assert_eq!(n(&eval(&format!("{F},0,0.15,1)"))), 330.0);
    }

    #[test]
    fn coefficient_table() {
        // life < 3 -> coeff 1: rate 0.5 -> eff 0.5.
        let d1 = n(&eval(
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.5,1)",
        ));
        let d0 = n(&eval(
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.5,1)",
        ));
        assert_eq!(d1, ((2400.0 - d0) * 0.5).round());
        // 3 <= life < 5 -> coeff 1.5: rate 0.25 -> eff 0.375.
        let d0 = n(&eval(
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.25,1)",
        ));
        let d1 = n(&eval(
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.25,1)",
        ));
        assert_eq!(d1, ((2400.0 - d0) * 0.375).round());
    }

    #[test]
    fn straight_line_tail() {
        // Once the residual would go negative, remaining periods are 0
        // and the last reachable one takes half the book value.
        let late = n(&eval(&format!("{F},20,0.15,1)")));
        assert_eq!(late, 0.0);
    }

    #[test]
    fn period_truncates() {
        assert_eq!(n(&eval(&format!("{F},1.9,0.15,1)"))), 776.0);
    }

    #[test]
    fn basis_variants() {
        // Basis 0: 132/360 proration of period 0.
        let d0 = n(&eval(&format!("{F},0,0.15,0)")));
        assert_eq!(d0, (2400.0_f64 * 0.375 * 132.0 / 360.0).round());
        // Default basis is 0.
        assert_eq!(
            n(&eval(&format!("{F},0,0.15)"))),
            n(&eval(&format!("{F},0,0.15,0)")))
        );
    }

    #[test]
    fn invalid_inputs_num() {
        assert_eq!(
            e(&eval(
                "=AMORDEGRC(2400,DATE(2008,12,31),DATE(2008,8,19),300,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(e(&eval(&format!("{F},1,0,1)"))), CalcError::Num);
        assert_eq!(
            e(&eval(
                "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),2500,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=AMORDEGRC(0,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(e(&eval(&format!("{F},-1,0.15,1)"))), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(e(&eval(&format!("{F},1,0.15,5)"))), CalcError::Num);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(
                r#"=AMORDEGRC("x",DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"#
            )),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval(
                "=AMORDEGRC(1/0,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"
            )),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=AMORDEGRC(1,2,3,4,5)")), CalcError::Value);
        assert_eq!(e(&eval("=AMORDEGRC(1,2,3,4,5,6,7,8)")), CalcError::Value);
    }
}
