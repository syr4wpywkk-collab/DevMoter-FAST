//! `FIXED(number, [decimals], [no_commas])` — formats a number as
//! text with a fixed number of decimal places.
//! Spec: `docs/functions/FIXED.md`.
//!
//! en-US fixed-locale output via
//! [`crate::common::number::format_fixed`]: `,` grouping unless
//! `no_commas` is true, `.` decimal point, leading `-` for negatives,
//! half-away-from-zero rounding. `decimals` defaults to 2 and is
//! truncated toward zero; negative values round left of the point.

use crate::common::{coercion, number};
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Shared `decimals` handling for `FIXED`/`DOLLAR`: optional numeric
/// argument, truncated toward zero; non-finite is `#VALUE!`.
pub(crate) fn eval_decimals(
    ctx: &mut EvalContext<'_>,
    arg: Option<&Expr>,
    default: f64,
) -> Result<Result<i32, calc_core::error::CalcError>, EvalError> {
    match coercion::eval_opt_number(ctx, arg, default)? {
        Err(e) => Ok(Err(e)),
        Ok(n) if !n.is_finite() => Ok(Err(calc_core::error::CalcError::Value)),
        Ok(n) => Ok(Ok(n.trunc().clamp(-30.0, 30.0) as i32)),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 3) {
        return Ok(Value::Error(e));
    }
    let n = match coercion::eval_number(ctx, &args[0])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let decimals = match eval_decimals(ctx, args.get(1), 2.0)? {
        Ok(d) => d,
        Err(e) => return Ok(Value::Error(e)),
    };
    let no_commas = match args.get(2) {
        Some(arg) => match ctx.eval(arg)?.to_boolean() {
            Ok(b) => b,
            Err(e) => return Ok(Value::Error(e)),
        },
        None => false,
    };
    Ok(Value::Text(number::format_fixed(n, decimals, !no_commas)))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn default_two_decimals() {
        assert_eq!(t(&eval("=FIXED(1234.567)")), "1,234.57");
    }

    #[test]
    fn one_decimal() {
        assert_eq!(t(&eval("=FIXED(1234.567,1)")), "1,234.6");
    }

    #[test]
    fn negative_decimals_round_left() {
        assert_eq!(t(&eval("=FIXED(1234.567,-1)")), "1,230");
        assert_eq!(t(&eval("=FIXED(1234.567,-2)")), "1,200");
    }

    #[test]
    fn negative_number_leading_minus() {
        assert_eq!(t(&eval("=FIXED(-1234.567,1)")), "-1,234.6");
    }

    #[test]
    fn no_commas() {
        assert_eq!(t(&eval("=FIXED(1234.567,1,TRUE)")), "1234.6");
        assert_eq!(t(&eval("=FIXED(1234.567,1,FALSE)")), "1,234.6");
    }

    #[test]
    fn zero_decimals() {
        assert_eq!(t(&eval("=FIXED(99.5,0)")), "100");
        assert_eq!(t(&eval("=FIXED(2.5,0)")), "3");
    }

    #[test]
    fn pads_zeros() {
        assert_eq!(t(&eval("=FIXED(5,3)")), "5.000");
    }

    #[test]
    fn small_value() {
        assert_eq!(t(&eval("=FIXED(0.009,2)")), "0.01");
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(t(&eval(r#"=FIXED("12.5",1)"#)), "12.5");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=FIXED(TRUE,0)")), "1");
    }

    #[test]
    fn blank_is_zero() {
        assert_eq!(t(&eval("=FIXED(A1)")), "0.00");
    }

    #[test]
    fn decimals_truncates() {
        assert_eq!(t(&eval("=FIXED(1.05,1.9)")), "1.1");
    }

    #[test]
    fn nonnumeric_is_value_error() {
        assert_eq!(e(&eval(r#"=FIXED("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FIXED(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=FIXED(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=FIXED(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FIXED()")), CalcError::Value);
        assert_eq!(e(&eval("=FIXED(1,2,TRUE,4)")), CalcError::Value);
    }
}
