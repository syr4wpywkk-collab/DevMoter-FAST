//! `Z.TEST(array, x, [sigma])` — one-tailed z-test probability
//! `P(Z >= z)` for `z = (mean(array) - x) / (sigma / sqrt(n))`.
//! Spec: `docs/functions/Z.TEST.md`.
//!
//! `sigma` omitted -> the sample sd of `array` (Excel's documented
//! default). `sigma <= 0` -> `#NUM!`; empty `array` -> `#N/A`; omitted
//! `sigma` with `n < 2` or zero sd -> `#DIV/0!`. The upper tail uses
//! `erfc` directly so the far tail keeps precision.

use crate::common::{coercion, numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, &args[0..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let x = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let sigma = match args.get(2) {
        Some(Expr::Missing) | None => None,
        Some(a) => match statistics::scalar_number(ctx, a)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => {
                if s <= 0.0 {
                    return Ok(Value::Error(CalcError::Num));
                }
                Some(s)
            }
        },
    };
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::NA));
    }
    let sd = match sigma {
        Some(s) => s,
        None => match statistics::sample_variance(&nums) {
            Some(v) if v > 0.0 => v.sqrt(),
            _ => return Ok(Value::Error(CalcError::DivZero)),
        },
    };
    let n = nums.len() as f64;
    let mean = nums.iter().sum::<f64>() / n;
    let z = (mean - x) / (sd / n.sqrt());
    Ok(Value::Number(
        0.5 * numerics::erfc(z / std::f64::consts::SQRT_2),
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
    fn excel_doc_low_x() {
        // Excel doc: Z.TEST({3;6;7;8;6;5;4;2;1;9}, 4) = 0.090574
        let v = n(&eval("=Z.TEST({3;6;7;8;6;5;4;2;1;9},4)"));
        assert!((v - 0.0905742).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn excel_doc_high_x() {
        // Excel doc: Z.TEST({3;6;7;8;6;5;4;2;1;9}, 6) = 0.863043
        let v = n(&eval("=Z.TEST({3;6;7;8;6;5;4;2;1;9},6)"));
        assert!((v - 0.8630434).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn known_sigma() {
        // Same data, x=5, sigma=2 -> 0.437184
        let v = n(&eval("=Z.TEST({3;6;7;8;6;5;4;2;1;9},5,2)"));
        assert!((v - 0.4371835).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn x_equal_mean_gives_half() {
        let v = n(&eval("=Z.TEST({1;2;3},2)"));
        assert!((v - 0.5).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn empty_array_na() {
        let v = eval_with(&[("A1", "x".into())], "=Z.TEST(A1:A3,5)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn sigma_zero_num() {
        assert_eq!(e(&eval("=Z.TEST({1;2;3},2,0)")), CalcError::Num);
    }

    #[test]
    fn sigma_negative_num() {
        assert_eq!(e(&eval("=Z.TEST({1;2;3},2,-1)")), CalcError::Num);
    }

    #[test]
    fn single_value_no_sigma_div_zero() {
        assert_eq!(e(&eval("=Z.TEST({5},5)")), CalcError::DivZero);
    }

    #[test]
    fn constant_data_no_sigma_div_zero() {
        // Zero sample sd with omitted sigma -> #DIV/0!
        assert_eq!(e(&eval("=Z.TEST({5;5;5},4)")), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", "x".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 7.0.into()),
                ("A5", 5.0.into()),
            ],
            "=Z.TEST(A1:A6,5)",
        );
        assert_eq!(n(&v), n(&eval("=Z.TEST({3;7;5},5)")));
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(e(&eval(r#"=Z.TEST({1;2;3},"x")"#)), CalcError::Value);
    }

    #[test]
    fn non_numeric_sigma_value() {
        assert_eq!(e(&eval(r#"=Z.TEST({1;2;3},2,"x")"#)), CalcError::Value);
    }

    #[test]
    fn missing_sigma_uses_sample() {
        assert_eq!(
            n(&eval("=Z.TEST({1;2;3;4},2.5,)")),
            n(&eval("=Z.TEST({1;2;3;4},2.5)"))
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=Z.TEST({1;2},1/0)")), CalcError::DivZero);
    }
}
