//! `ISO.CEILING(number, [significance])` — rounds `number` up to a
//! multiple of `significance`, away from zero regardless of signs.
//! Spec: `docs/functions/ISO.CEILING.md`.
//!
//! `significance` sign is ignored; `0` yields `0` (SPEC-OPEN, shared
//! with `CEILING.MATH`/`FLOOR.MATH`). The spec documents
//! `ISO.CEILING(-4.3)` -> `-5` (away from zero), matching the spec's
//! equivalence claim with `CEILING.PRECISE` under that reading —
//! whether any real difference vs `CEILING.PRECISE` exists is
//! SPEC-OPEN in the spec doc.

use crate::common::number::round_to_significance;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let sig = if args.len() == 2 {
        match ctx.eval(&args[1])?.to_number() {
            Ok(n) => n.abs(),
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        1.0
    };
    // Away from zero: round |x| toward +inf, then restore the sign.
    Ok(Value::Number(
        round_to_significance(x.abs(), sig, true).copysign(x),
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
    fn spec_examples() {
        assert_eq!(n(&eval("=ISO.CEILING(4.3)")), 5.0);
        assert_eq!(n(&eval("=ISO.CEILING(-4.3,1)")), -5.0);
        assert_eq!(n(&eval("=ISO.CEILING(4.3,0.5)")), 4.5);
    }

    #[test]
    fn default_significance() {
        assert_eq!(n(&eval("=ISO.CEILING(4.3)")), 5.0);
        assert_eq!(n(&eval("=ISO.CEILING(-4.3)")), -5.0);
    }

    #[test]
    fn exact_multiple_unchanged() {
        assert_eq!(n(&eval("=ISO.CEILING(4,1)")), 4.0);
        assert_eq!(n(&eval("=ISO.CEILING(-4,1)")), -4.0);
        assert_eq!(n(&eval("=ISO.CEILING(4.5,0.5)")), 4.5);
    }

    #[test]
    fn zero_input() {
        assert_eq!(n(&eval("=ISO.CEILING(0,0.5)")), 0.0);
    }

    #[test]
    fn negative_significance_ignored() {
        assert_eq!(n(&eval("=ISO.CEILING(4.3,-0.5)")), 4.5);
        assert_eq!(n(&eval("=ISO.CEILING(-4.3,-1)")), -5.0);
    }

    #[test]
    fn zero_significance() {
        // SPEC-OPEN (shared with CEILING.MATH): implemented as 0.
        assert_eq!(n(&eval("=ISO.CEILING(4.3,0)")), 0.0);
    }

    #[test]
    fn fractional_significance() {
        assert!((n(&eval("=ISO.CEILING(1.11,0.05)")) - 1.15).abs() < 1e-12);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=ISO.CEILING("4.3")"#)), 5.0);
        assert_eq!(n(&eval(r#"=ISO.CEILING(4.3,"0.5")"#)), 4.5);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ISO.CEILING("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=ISO.CEILING(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ISO.CEILING(TRUE)")), 1.0);
        assert_eq!(n(&eval("=ISO.CEILING(0.1,FALSE)")), 0.0);
    }

    #[test]
    fn blank_ref_coerces_zero() {
        assert_eq!(n(&eval("=ISO.CEILING(A1,2)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISO.CEILING(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISO.CEILING(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISO.CEILING()")), CalcError::Value);
        assert_eq!(e(&eval("=ISO.CEILING(1,1,1)")), CalcError::Value);
    }
}
