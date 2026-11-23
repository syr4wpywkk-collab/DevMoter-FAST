//! `SUBTOTAL(function_num, ref1, [ref2], ...)` — aggregate over ranges,
//! selectable by `function_num` (1-11 or 101-111). Spec:
//! `docs/functions/SUBTOTAL.md`.
//!
//! `ref` arguments must be references/ranges — a non-reference scalar is
//! `#VALUE!`. Error cells inside the ranges propagate. DEVIATION
//! (SPEC-OPEN): the workbook model has no hidden-row/filter state, so
//! 101-111 currently alias to 1-11 (include hidden rows); once hidden
//! state exists they must exclude manually-hidden rows. Nested SUBTOTAL
//! cells inside a referenced range cannot be detected through the
//! evaluated-value model and are *not* skipped here.

use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let op = match ctx.eval(&args[0])?.to_number() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(f) if f.is_finite() => match f.trunc() as i64 {
            n @ (1..=11 | 101..=111) => n % 100,
            _ => return Ok(Value::Error(CalcError::Value)),
        },
        Ok(_) => return Ok(Value::Error(CalcError::Num)),
    };

    // Gather every referenced cell. Errors inside ranges propagate per
    // the underlying aggregate's rules (all SUBTOTAL ops propagate).
    let mut nums: Vec<f64> = Vec::new();
    let mut counta = 0usize;
    for expr in &args[1..] {
        match ctx.eval_arg(expr)? {
            ArgValue::Ref(v) => {
                if let Err(e) = push_cell(v, &mut nums, &mut counta) {
                    return Ok(Value::Error(e));
                }
            }
            ArgValue::Range(a) => {
                for v in a.into_iter() {
                    if let Err(e) = push_cell(v, &mut nums, &mut counta) {
                        return Ok(Value::Error(e));
                    }
                }
            }
            ArgValue::Scalar(v) => {
                // Non-reference arguments are rejected; an error value
                // still propagates first.
                if let Some(e) = v.error() {
                    return Ok(Value::Error(e));
                }
                return Ok(Value::Error(CalcError::Value));
            }
        }
    }

    let n = nums.len() as f64;
    let sum: f64 = nums.iter().sum();
    let result = match op {
        1 => {
            if nums.is_empty() {
                return Ok(Value::Error(CalcError::DivZero));
            }
            sum / n
        }
        2 => n,
        3 => counta as f64,
        4 => {
            if nums.is_empty() {
                0.0
            } else {
                nums.iter().copied().fold(f64::NEG_INFINITY, f64::max)
            }
        }
        5 => {
            if nums.is_empty() {
                0.0
            } else {
                nums.iter().copied().fold(f64::INFINITY, f64::min)
            }
        }
        6 => nums.iter().product(),
        7 => match statistics::sample_variance(&nums) {
            None => return Ok(Value::Error(CalcError::DivZero)),
            Some(v) => v.sqrt(),
        },
        8 => match statistics::population_variance(&nums) {
            None => return Ok(Value::Error(CalcError::DivZero)),
            Some(v) => v.sqrt(),
        },
        9 => sum,
        10 => match statistics::sample_variance(&nums) {
            None => return Ok(Value::Error(CalcError::DivZero)),
            Some(v) => v,
        },
        _ => match statistics::population_variance(&nums) {
            None => return Ok(Value::Error(CalcError::DivZero)),
            Some(v) => v,
        },
    };
    if !result.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(result))
}

fn push_cell(v: Value, nums: &mut Vec<f64>, counta: &mut usize) -> Result<(), CalcError> {
    match v {
        Value::Number(x) => {
            nums.push(x);
            *counta += 1;
        }
        // Blank is neither a number nor countable.
        Value::Blank => {}
        // Errors propagate per the aggregate rules.
        Value::Error(e) => return Err(e),
        // Non-numeric, non-blank cells count for COUNTA only.
        _ => *counta += 1,
    }
    Ok(())
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

    fn inputs() -> [(&'static str, Value); 5] {
        [
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
            ("A5", 5.0.into()),
        ]
    }

    #[test]
    fn sum() {
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(9,A1:A5)")), 15.0);
    }

    #[test]
    fn average() {
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(1,A1:A5)")), 3.0);
    }

    #[test]
    fn count() {
        let mut i = inputs().to_vec();
        i.push(("A6", "x".into()));
        assert_eq!(n(&eval_with(&i, "=SUBTOTAL(2,A1:A6)")), 5.0);
    }

    #[test]
    fn counta() {
        let mut i = inputs().to_vec();
        i.push(("A6", "x".into()));
        i.push(("A7", Value::Boolean(true)));
        assert_eq!(n(&eval_with(&i, "=SUBTOTAL(3,A1:A7)")), 7.0);
    }

    #[test]
    fn max_min() {
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(4,A1:A5)")), 5.0);
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(5,A1:A5)")), 1.0);
    }

    #[test]
    fn product() {
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(6,A1:A5)")), 120.0);
    }

    #[test]
    fn stdev_s_and_var_s() {
        // sample var of 1..5 = 2.5, stdev = sqrt(2.5).
        assert!((n(&eval_with(&inputs(), "=SUBTOTAL(10,A1:A5)")) - 2.5).abs() < 1e-14);
        assert!((n(&eval_with(&inputs(), "=SUBTOTAL(7,A1:A5)")) - 2.5f64.sqrt()).abs() < 1e-14);
    }

    #[test]
    fn stdev_p_and_var_p() {
        // population var of 1..5 = 2.0.
        assert!((n(&eval_with(&inputs(), "=SUBTOTAL(11,A1:A5)")) - 2.0).abs() < 1e-14);
        assert!((n(&eval_with(&inputs(), "=SUBTOTAL(8,A1:A5)")) - 2.0f64.sqrt()).abs() < 1e-14);
    }

    #[test]
    fn function_num_101_plus_alias() {
        // DEVIATION: no hidden-row state -> 109 aliases to 9.
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(109,A1:A5)")), 15.0);
        assert_eq!(n(&eval_with(&inputs(), "=SUBTOTAL(103,A1:A5)")), 5.0);
    }

    #[test]
    fn multiple_ranges() {
        let i = [
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("B1", 3.0.into()),
            ("B2", 4.0.into()),
        ];
        assert_eq!(n(&eval_with(&i, "=SUBTOTAL(9,A1:A2,B1:B2)")), 10.0);
    }

    #[test]
    fn bad_function_num() {
        assert_eq!(
            e(&eval_with(&inputs(), "=SUBTOTAL(0,A1:A5)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&inputs(), "=SUBTOTAL(12,A1:A5)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&inputs(), "=SUBTOTAL(100,A1:A5)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&inputs(), "=SUBTOTAL(112,A1:A5)")),
            CalcError::Value
        );
    }

    #[test]
    fn non_reference_arg_rejected() {
        assert_eq!(e(&eval("=SUBTOTAL(9,5)")), CalcError::Value);
    }

    #[test]
    fn average_empty_div0() {
        let v = eval_with(&[("A1", "x".into())], "=SUBTOTAL(1,A1:A2)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn stdev_s_single_div0() {
        let v = eval_with(&[("A1", 1.0.into())], "=SUBTOTAL(7,A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn max_empty_zero() {
        let v = eval_with(&[("A1", "x".into())], "=SUBTOTAL(4,A1:A2)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=SUBTOTAL(9,A1,1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SUBTOTAL(9)")), CalcError::Value);
    }
}
