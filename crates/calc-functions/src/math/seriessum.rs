//! `SERIESSUM(x, n, m, coefficients)` — power-series sum
//! `Σ_i a_i · x^(n + i·m)` over the coefficient list. Spec:
//! `docs/functions/SERIESSUM.md`.
//!
//! Coefficients iterate row-major over any array/range shape (2-D
//! shapes flatten — SPEC-OPEN in the spec doc whether Excel flattens or
//! errors). Range members follow the range rule: numbers contribute,
//! blanks are skipped, errors propagate, other non-numerics are
//! `#VALUE!`; scalar/array members coerce via `to_number`. `x = 0` with
//! a non-positive exponent, and any non-finite term/sum, is `#NUM!`.

use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n0 = match ctx.eval(&args[1])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let m = match ctx.eval(&args[2])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };

    // Coefficient members as (value, range_derived) pairs, row-major
    // (2-D shapes flatten — SPEC-OPEN whether Excel flattens or errors).
    // Range/array members follow the range rule: blanks contribute no
    // term, other non-numerics are `#VALUE!`; scalars coerce.
    let members = statistics::arg_members(ctx, &args[3])?;
    let mut coeffs: Vec<f64> = Vec::with_capacity(members.len());
    for (v, ranged) in members {
        match statistics::member_number(&v, ranged) {
            Err(e) => return Ok(Value::Error(e)),
            Ok(Some(c)) => coeffs.push(c),
            Ok(None) => {
                if ranged && !v.is_blank() {
                    return Ok(Value::Error(CalcError::Value));
                }
            }
        }
    }

    let mut total = 0.0;
    for (i, a) in coeffs.iter().enumerate() {
        let exp = n0 + i as f64 * m;
        if x == 0.0 && exp <= 0.0 {
            // 0^0 and 0^negative are undefined.
            return Ok(Value::Error(CalcError::Num));
        }
        let term = a * x.powf(exp);
        total += term;
        if !total.is_finite() {
            return Ok(Value::Error(CalcError::Num));
        }
    }
    Ok(Value::Number(total))
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
    fn microsoft_sin_example() {
        // cos(pi/4) via the Taylor coefficients 1, -1/2!, 1/4!, -1/6!, 1/8!
        // (the documented Microsoft example approximates 0.707103).
        let v = n(&eval(
            "=SERIESSUM(PI()/4,0,2,{1,-0.5,0.0416666666666667,-0.00138888888888889,0.0000248015873015873})",
        ));
        assert!((v - 0.707103).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn simple_series() {
        // 1*x^0 + 2*x^1 + 3*x^2 at x=2 -> 1+4+12 = 17.
        assert_eq!(n(&eval("=SERIESSUM(2,0,1,{1,2,3})")), 17.0);
    }

    #[test]
    fn range_coefficients() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=SERIESSUM(2,0,1,A1:A3)",
        );
        assert_eq!(n(&v), 17.0);
    }

    #[test]
    fn nonzero_first_exponent() {
        // 2*x^2 + 3*x^4 at x=1 -> 5.
        assert_eq!(n(&eval("=SERIESSUM(1,2,2,{2,3})")), 5.0);
    }

    #[test]
    fn fractional_exponent_step() {
        // a*x^0.5: 4*sqrt(9) = 12.
        assert_eq!(n(&eval("=SERIESSUM(9,0.5,1,{4})")), 12.0);
    }

    #[test]
    fn x_zero_positive_n() {
        assert_eq!(n(&eval("=SERIESSUM(0,1,1,{1,2})")), 0.0);
    }

    #[test]
    fn x_zero_nonpositive_n_num() {
        assert_eq!(e(&eval("=SERIESSUM(0,0,1,{1,2})")), CalcError::Num);
        assert_eq!(e(&eval("=SERIESSUM(0,-1,1,{1,2})")), CalcError::Num);
    }

    #[test]
    fn text_coefficient_value() {
        assert_eq!(e(&eval("=SERIESSUM(2,0,1,{1,\"x\"})")), CalcError::Value);
    }

    #[test]
    fn blank_range_cell_skipped() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", Value::Blank), ("A3", 3.0.into())],
            "=SERIESSUM(2,0,1,A1:A3)",
        );
        // Blank contributes no term: 1*2^0 + 3*2^1 = 7.
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=SERIESSUM(2,0,1,A1)");
        assert_eq!(n(&v), 1.0);
        let v = eval_with(&[("A1", 1.0.into())], "=SERIESSUM(2,0,1,1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn scalar_coefficient() {
        assert_eq!(n(&eval("=SERIESSUM(3,2,1,4)")), 36.0);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=SERIESSUM(10,400,1,{1})")), CalcError::Num);
    }

    #[test]
    fn bad_scalar_args() {
        assert_eq!(e(&eval("=SERIESSUM(\"x\",0,1,{1})")), CalcError::Value);
        assert_eq!(e(&eval("=SERIESSUM(1,0,1/0,{1})")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SERIESSUM(1,0,1)")), CalcError::Value);
        assert_eq!(e(&eval("=SERIESSUM(1,0,1,{1},5)")), CalcError::Value);
    }
}
