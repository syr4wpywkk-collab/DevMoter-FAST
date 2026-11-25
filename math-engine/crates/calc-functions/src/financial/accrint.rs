//! `ACCRINT(issue, first_interest, settlement, rate, [par], frequency,
//! [basis], [calc_method])` — accrued interest for a security paying
//! periodic interest. Spec: `docs/functions/ACCRINT.md`.
//!
//! `par * (rate/frequency) * Σᵢ Aᵢ/NLᵢ` where the accrual window
//! `[accrue_from, settlement]` is split at the quasi-coupon dates
//! anchored at `first_interest` (step `12/frequency` months, same
//! sticky-EOM rules as the coupon schedule). `accrue_from` is `issue`
//! when `calc_method` is TRUE/omitted, `first_interest` when FALSE.
//! `Aᵢ` counts days in each slice under `basis`; `NLᵢ` is the nominal
//! period length — `360/frequency` (bases 0/2/4), `365/frequency`
//! (basis 3), or the actual length of the enclosing quasi-coupon
//! period (basis 1).
//!
//! SPEC-OPEN (also in the spec doc): the quasi-coupon construction for
//! odd first periods and `calc_method` on those schedules needs
//! reference confirmation; basis-1 `NLᵢ` anchoring likewise.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::{date_serial, finance};
use finance::DayCountBasis;

use super::{basis_arg, freq_arg, number_arg, opt_bool_arg, opt_number_arg, serial_arg};

/// Serial of the quasi-coupon date `k` periods of `step` months after
/// `anchor` (negative `k` walks backward).
fn quasi_serial(
    anchor: (i64, u32, u32),
    k: i64,
    step: i64,
    system: calc_core::workbook::DateSystem,
) -> Option<i64> {
    let (y, m, d) = finance::coupon_date_back(anchor, -k, step, system)?;
    date_serial::date_to_serial(y, m, d as i64, system)
}

/// Smallest quasi index `k` whose date is `> base` (exclusive lower
/// bound of the accrual window's interior boundaries).
fn first_k_above(
    anchor: (i64, u32, u32),
    base: i64,
    step: i64,
    system: calc_core::workbook::DateSystem,
) -> Option<i64> {
    let mut k: i64 = 0;
    // Bracket: move q_k to just above `base`.
    let mut guard = 0;
    while let Some(q) = quasi_serial(anchor, k, step, system) {
        if q > base {
            break;
        }
        k += 1;
        guard += 1;
        if guard > 1_000_000 {
            return None;
        }
    }
    let mut guard = 0;
    while k > i64::MIN / 2
        && matches!(quasi_serial(anchor, k - 1, step, system), Some(q) if q > base)
    {
        k -= 1;
        guard += 1;
        if guard > 1_000_000 {
            return None;
        }
    }
    Some(k)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 6, 8) {
        return Ok(Value::Error(e));
    }
    let system = ctx.date_system();
    macro_rules! take {
        ($e:expr) => {
            match $e? {
                Ok(v) => v,
                Err(e) => return Ok(Value::Error(e)),
            }
        };
    }
    let issue = take!(serial_arg(ctx, args, 0, system));
    let first_interest = take!(serial_arg(ctx, args, 1, system));
    let settlement = take!(serial_arg(ctx, args, 2, system));
    let rate = take!(number_arg(ctx, args, 3));
    let par = take!(opt_number_arg(ctx, args, 4, 1000.0));
    let frequency = take!(freq_arg(ctx, args, 5));
    let basis = take!(basis_arg(ctx, args, 6));
    let calc = take!(opt_bool_arg(ctx, args, 7, true));
    if issue >= settlement || rate <= 0.0 || par <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let accrue_from = if calc { issue } else { first_interest };
    if accrue_from >= settlement {
        return Ok(Value::Error(CalcError::Num));
    }
    let step = match finance::months_per_period(frequency) {
        Some(s) => s,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let anchor = match date_serial::serial_to_date(first_interest, system) {
        Some(t) => t,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    // Boundaries: accrue_from, quasi dates in (accrue_from, settlement],
    // then settlement.
    let k0 = match first_k_above(anchor, accrue_from, step, system) {
        Some(k) => k,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let mut bounds = vec![accrue_from];
    let quasi_after_end;
    let mut k = k0;
    loop {
        let q = match quasi_serial(anchor, k, step, system) {
            Some(q) => q,
            None => return Ok(Value::Error(CalcError::Num)),
        };
        if q >= settlement {
            quasi_after_end = q;
            break;
        }
        bounds.push(q);
        k += 1;
        if bounds.len() > 1_000_000 {
            return Ok(Value::Error(CalcError::Num));
        }
    }
    bounds.push(settlement);
    let fixed_nl = match basis {
        DayCountBasis::ActAct => None,
        _ => finance::coupon_period_days(basis, frequency, 0, 0, system),
    };
    let mut sum = 0.0;
    for w in bounds.windows(2) {
        let (s, e) = (w[0], w[1]);
        let a_i = match finance::days_between(s, e, basis, system) {
            Some(d) => d as f64,
            None => return Ok(Value::Error(CalcError::Num)),
        };
        let nl = match fixed_nl {
            Some(nl) => nl,
            None => {
                // Enclosing quasi period for interval end `e`: when `e`
                // is an interior boundary it is itself a quasi date;
                // for `e == settlement` the enclosing period ends at
                // the first quasi date >= settlement.
                let q_hi = if e == settlement { quasi_after_end } else { e };
                let q_lo = match quasi_serial(
                    match date_serial::serial_to_date(q_hi, system) {
                        Some(t) => t,
                        None => return Ok(Value::Error(CalcError::Num)),
                    },
                    -1,
                    step,
                    system,
                ) {
                    Some(q) => q,
                    None => return Ok(Value::Error(CalcError::Num)),
                };
                (q_hi - q_lo) as f64
            }
        };
        sum += a_i / nl;
    }
    Ok(Value::Number(par * (rate / frequency as f64) * sum))
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
    fn spec_examples() {
        assert!(
            (n(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"
            )) - 16.66666667)
                .abs()
                < 1e-6
        );
        assert!(
            (n(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,3)"
            )) - 16.71232877)
                .abs()
                < 1e-6
        );
        assert!(
            (n(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,,2,0)"
            )) - 16.66666667)
                .abs()
                < 1e-6
        );
        assert_eq!(
            e(&eval(
                "=ACCRINT(DATE(2008,5,1),DATE(2008,8,31),DATE(2008,3,1),0.1,1000,2,0)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn basis1_actual() {
        // issue->settlement 61 actual days; enclosing quasi period
        // [2008-02-29, 2008-08-31] -> 184 actual days.
        let v = n(&eval(
            "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,1)",
        ));
        assert!((v - 1000.0 * 0.05 * 61.0 / 184.0).abs() < 1e-6);
    }

    #[test]
    fn calc_method_false() {
        // Accrue from first_interest: negative/short windows error only
        // when first_interest >= settlement.
        assert_eq!(
            e(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0,FALSE)"
            )),
            CalcError::Num
        );
        // Settlement after first_interest accrues from it.
        let v = n(&eval(
            "=ACCRINT(DATE(2008,3,1),DATE(2008,5,1),DATE(2008,7,1),0.1,1000,2,0,FALSE)",
        ));
        assert!(v > 0.0);
    }

    #[test]
    fn calc_method_default_true() {
        assert_eq!(
            n(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"
            )),
            n(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0,TRUE)"
            ))
        );
    }

    #[test]
    fn multi_quasi_period() {
        // Settlement beyond first_interest: two quasi slices.
        // [2007-03-01, 2007-08-31] = 180 30/360 days, plus
        // [2007-08-31, 2008-02-01] = 151, each over NL=180.
        let v = n(&eval(
            "=ACCRINT(DATE(2007,3,1),DATE(2007,8,31),DATE(2008,2,1),0.1,1000,2,0)",
        ));
        assert!((v - 1000.0 * 0.05 * (331.0 / 180.0)).abs() < 1e-6);
    }

    #[test]
    fn invalid_numeric_args_num() {
        assert_eq!(
            e(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0,1000,2,0)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,0,2,0)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,5,0)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,9)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn dates_truncated() {
        assert!(
            (n(&eval(
                "=ACCRINT(DATE(2008,3,1)+0.9,DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"
            )) - 16.66666667)
                .abs()
                < 1e-6
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(
                r#"=ACCRINT("x",DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"#
            )),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval(
                "=ACCRINT(1/0,DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"
            )),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ACCRINT(1,2,3,4,5)")), CalcError::Value);
        assert_eq!(e(&eval("=ACCRINT(1,2,3,4,5,6,7,8,9)")), CalcError::Value);
    }
}
