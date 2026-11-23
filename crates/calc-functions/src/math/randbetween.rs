//! `RANDBETWEEN(bottom, top)` — uniform random integer in the inclusive
//! bounds. Volatile like `RAND`. Spec: `docs/functions/RANDBETWEEN.md`.
//!
//! Bound coercion: `bottom` is rounded up (`ceil`), `top` down
//! (`floor`) — the documented Excel coercion for fractional bounds
//! (RANDBETWEEN.md open question; a specOpen fixture records the
//! question). `bottom > top` after coercion is `#VALUE!`.

use crate::common::{coercion, random};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let bottom = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) if n.is_finite() => n.ceil(),
        _ => return Ok(Value::Error(CalcError::Value)),
    };
    let top = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) if n.is_finite() => n.floor(),
        _ => return Ok(Value::Error(CalcError::Value)),
    };
    // Bounds beyond exact-integer range are meaningless draws.
    if bottom < i64::MIN as f64 || top > i64::MAX as f64 || bottom > top {
        return Ok(Value::Error(CalcError::Value));
    }
    Ok(Value::Number(
        random::uniform_i64(ctx.rng(), bottom as i64, top as i64) as f64,
    ))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcEngine, CalcError, CellInput, Value};

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

    fn engine() -> CalcEngine {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.add_sheet("Sheet1").unwrap();
        e
    }

    #[test]
    fn within_bounds() {
        let mut e = engine();
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=RANDBETWEEN(1,6)"))
            .unwrap();
        for _ in 0..200 {
            let x = n(&e.get_value("Sheet1", "A1").unwrap());
            assert!((1.0..=6.0).contains(&x) && x == x.trunc(), "bad draw {x}");
        }
    }

    #[test]
    fn equal_bounds() {
        assert_eq!(n(&eval("=RANDBETWEEN(5,5)")), 5.0);
    }

    #[test]
    fn negative_bounds() {
        let mut e = engine();
        e.set_cell(
            "Sheet1",
            "A1",
            CellInput::from_typed("=RANDBETWEEN(-10,-5)"),
        )
        .unwrap();
        for _ in 0..50 {
            let x = n(&e.get_value("Sheet1", "A1").unwrap());
            assert!((-10.0..=-5.0).contains(&x));
        }
    }

    #[test]
    fn inverted_bounds_error() {
        assert_eq!(e(&eval("=RANDBETWEEN(10,5)")), CalcError::Value);
    }

    #[test]
    fn inverted_after_bound_coercion() {
        assert_eq!(e(&eval("=RANDBETWEEN(5.6,5.4)")), CalcError::Value);
    }

    #[test]
    fn fractional_bounds_coerced() {
        // bottom 0.5 -> 1, top 9.5 -> 9.
        let mut e = engine();
        e.set_cell(
            "Sheet1",
            "A1",
            CellInput::from_typed("=RANDBETWEEN(0.5,9.5)"),
        )
        .unwrap();
        for _ in 0..50 {
            let x = n(&e.get_value("Sheet1", "A1").unwrap());
            assert!((1.0..=9.0).contains(&x) && x == x.trunc());
        }
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((1.0..=3.0).contains(&n(&eval(r#"=RANDBETWEEN("1","3")"#))));
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=RANDBETWEEN("x",5)"#)), CalcError::Value);
    }

    #[test]
    fn error_args_propagate() {
        assert_eq!(e(&eval("=RANDBETWEEN(1/0,5)")), CalcError::DivZero);
        assert_eq!(e(&eval("=RANDBETWEEN(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=RANDBETWEEN(1)")), CalcError::Value);
        assert_eq!(e(&eval("=RANDBETWEEN(1,2,3)")), CalcError::Value);
    }

    #[test]
    fn volatile_recalcs() {
        let mut e = engine();
        e.set_cell(
            "Sheet1",
            "A1",
            CellInput::from_typed("=RANDBETWEEN(1,1000000)"),
        )
        .unwrap();
        let first = e.get_value("Sheet1", "A1").unwrap();
        let second = e.get_value("Sheet1", "A1").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn seeded_determinism() {
        use calc_core::SplitMix64;
        let mut e1 = engine();
        e1.set_rng(Box::new(SplitMix64::new(7)));
        e1.set_cell("Sheet1", "A1", CellInput::from_typed("=RANDBETWEEN(1,10)"))
            .unwrap();
        let mut e2 = engine();
        e2.set_rng(Box::new(SplitMix64::new(7)));
        e2.set_cell("Sheet1", "A1", CellInput::from_typed("=RANDBETWEEN(1,10)"))
            .unwrap();
        assert_eq!(
            e1.get_value("Sheet1", "A1").unwrap(),
            e2.get_value("Sheet1", "A1").unwrap()
        );
    }

    #[test]
    fn wide_range_no_bias() {
        // A range much larger than 2^32 still produces in-bounds values
        // (the draw path uses full 64-bit Lemire rejection).
        let mut e = engine();
        e.set_cell(
            "Sheet1",
            "A1",
            CellInput::from_typed("=RANDBETWEEN(-4503599627370496,4503599627370496)"),
        )
        .unwrap();
        for _ in 0..20 {
            let x = n(&e.get_value("Sheet1", "A1").unwrap());
            assert!(x.abs() <= 4503599627370496.0 && x == x.trunc());
        }
    }
}
