//! `NPV(rate, value1, [value2], ...)` — net present value of cash
//! flows at the end of periods 1..n. Spec: `docs/functions/NPV.md`.
//!
//! Scalar arguments coerce via `to_number` (numeric text included,
//! bad text -> `#VALUE!`); inside ranges/arrays only `Number` cells
//! count, other cells are skipped *without consuming a period index*
//! (NPV.md SPEC-OPEN); error cells propagate.

use crate::common::{coercion, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let rate = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let mut amounts = Vec::new();
    for arg in &args[1..] {
        match ctx.eval_arg(arg)? {
            ArgValue::Scalar(Value::Array(a)) | ArgValue::Range(a) => {
                for cell in a.iter() {
                    match cell {
                        Value::Number(n) => amounts.push(*n),
                        Value::Error(e) => return Ok(Value::Error(*e)),
                        // Text/bool/blank inside ranges skipped (spec-open
                        // whether the period index advances).
                        _ => {}
                    }
                }
            }
            ArgValue::Scalar(v) => match v.to_number() {
                Ok(n) => amounts.push(n),
                Err(e) => return Ok(Value::Error(e)),
            },
            ArgValue::Ref(v) => match v {
                Value::Number(n) => amounts.push(n),
                Value::Error(e) => return Ok(Value::Error(e)),
                _ => {}
            },
        }
    }
    let times: Vec<f64> = (1..=amounts.len()).map(|i| i as f64).collect();
    match finance::npv(rate, &times, &amounts) {
        Some(v) => Ok(Value::Number(v)),
        // rate <= -1 or non-finite inputs.
        None => Ok(Value::Error(CalcError::Num)),
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
        let v = eval("=NPV(0.1,-10000,3000,4200,6800)");
        assert!((n(&v) - 1188.44).abs() < 1e-2, "{v:?}");
    }

    #[test]
    fn array_literal() {
        let v = eval("=NPV(0.08,{8000,9200,10000,12000,14500})");
        // flows discounted at 8%: 192241.7... wait compute: sum v/1.08^i.
        let expected: f64 = [8000.0, 9200.0, 10000.0, 12000.0, 14500.0]
            .iter()
            .enumerate()
            .map(|(i, v)| v / 1.08f64.powi(i as i32 + 1))
            .sum();
        assert!((n(&v) - expected).abs() < 1e-9, "{v:?} vs {expected}");
    }

    #[test]
    fn zero_rate_is_sum() {
        assert_eq!(n(&eval("=NPV(0,100,200)")), 300.0);
    }

    #[test]
    fn scalar_text_number_coerces() {
        assert_eq!(n(&eval(r#"=NPV(0,"100",200)"#)), 300.0);
    }

    #[test]
    fn scalar_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=NPV(0.1,100,"abc")"#)), CalcError::Value);
    }

    #[test]
    fn range_skips_text_and_blank() {
        let v = eval_with(
            &[
                ("A1", 100.0.into()),
                ("A2", "skip".into()),
                ("A4", 200.0.into()),
            ],
            "=NPV(0,A1:A5)",
        );
        assert_eq!(n(&v), 300.0);
    }

    #[test]
    fn range_skipped_cells_do_not_shift_periods() {
        // SPEC-OPEN in NPV.md: blank/text inside a range are skipped
        // entirely rather than occupying a discounted period.
        let v = eval_with(
            &[("A1", 100.0.into()), ("A3", 300.0.into())],
            "=NPV(0.5,A1:A3)",
        );
        let expected = 100.0 / 1.5 + 300.0 / 1.5 / 1.5;
        assert!((n(&v) - expected).abs() < 1e-9, "{v:?} vs {expected}");
    }

    #[test]
    fn range_error_propagates() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", Value::Error(CalcError::NA))],
            "=NPV(0.1,A1:A3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn scalar_error_propagates() {
        assert_eq!(e(&eval("=NPV(0.1,1/0,5)")), CalcError::DivZero);
    }

    #[test]
    fn rate_at_minus_one_num() {
        assert_eq!(e(&eval("=NPV(-1,100)")), CalcError::Num);
    }

    #[test]
    fn classic_idiom() {
        // NPV of inflows minus t=0 outlay.
        let v = eval("=NPV(0.1,{3000,4200,6800})-10000");
        assert!((n(&v) - 1307.288).abs() < 1e-2, "{v:?}");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=NPV(0.1)")), CalcError::Value);
    }
}
