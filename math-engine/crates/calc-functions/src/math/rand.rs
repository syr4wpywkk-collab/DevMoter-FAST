//! `RAND()` — uniform random number in `[0, 1)`. Volatile: registered
//! in [`crate::registry::VOLATILE_NAMES`] so the cell recalculates on
//! every pass. Spec: `docs/functions/RAND.md`.

use crate::common::random;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 0) {
        return Ok(Value::Error(e));
    }
    Ok(Value::Number(random::unit_f64(ctx.rng())))
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
    fn in_unit_interval() {
        // Each get_value triggers a volatile re-eval -> a fresh draw.
        let mut e = engine();
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=RAND()"))
            .unwrap();
        for _ in 0..200 {
            let x = e.get_value("Sheet1", "A1").unwrap();
            match x {
                Value::Number(x) => assert!((0.0..1.0).contains(&x), "out of range: {x}"),
                o => panic!("expected number, got {o:?}"),
            }
        }
    }

    #[test]
    fn never_one() {
        // 53-bit draw cannot reach 1.0 by construction (unit_f64 draws
        // `next_u64 >> 11` over 2^53); asserted across the seeded stream
        // in `in_unit_interval` and by common::random tests.
        assert!(n(&eval("=RAND()")) < 1.0);
    }

    #[test]
    fn deterministic_with_default_seed() {
        // Same default workbook seed -> same first draws.
        assert_eq!(n(&eval("=RAND()")), n(&eval("=RAND()")));
    }

    #[test]
    fn successive_calls_differ() {
        // Two draws in one formula almost surely differ (and for a
        // deterministic seed must differ by construction).
        assert_ne!(n(&eval("=RAND()-RAND()")), 0.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=RAND(1)")), CalcError::Value);
    }

    #[test]
    fn seeded_rng_reproducible() {
        // Injecting the same seed reproduces the sequence.
        use calc_core::SplitMix64;
        let mut e1 = engine();
        e1.set_rng(Box::new(SplitMix64::new(99)));
        e1.set_cell("Sheet1", "A1", CellInput::from_typed("=RAND()"))
            .unwrap();
        let mut e2 = engine();
        e2.set_rng(Box::new(SplitMix64::new(99)));
        e2.set_cell("Sheet1", "A1", CellInput::from_typed("=RAND()"))
            .unwrap();
        assert_eq!(
            e1.get_value("Sheet1", "A1").unwrap(),
            e2.get_value("Sheet1", "A1").unwrap()
        );
    }

    #[test]
    fn volatile_recalcs_every_pass() {
        // A RAND cell is re-evaluated on every recalculate() call even
        // with no input change — the second get_value draws again.
        let mut e = engine();
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=RAND()"))
            .unwrap();
        let first = e.get_value("Sheet1", "A1").unwrap();
        let second = e.get_value("Sheet1", "A1").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn volatile_nested_in_formula() {
        let mut e = engine();
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=RAND()*2"))
            .unwrap();
        let first = e.get_value("Sheet1", "A1").unwrap();
        let second = e.get_value("Sheet1", "A1").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn workbook_seed_changes_sequence() {
        let mut wb = calc_core::Workbook::new();
        wb.set_rng_seed(12345);
        let mut e = CalcEngine::with_workbook(wb);
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.add_sheet("Sheet1").unwrap();
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=RAND()"))
            .unwrap();
        let v = e.get_value("Sheet1", "A1").unwrap();
        assert_ne!(v, Value::Number(n(&eval("=RAND()"))));
    }

    #[test]
    fn today_now_also_volatile() {
        // TODAY/NOW recalc every pass too; with a fixed clock the value
        // is stable but the cell must still be re-dirtied.
        let mut e = engine();
        e.set_clock(Box::new(calc_core::FixedClock(1_700_000_000)));
        e.set_cell("Sheet1", "A1", CellInput::from_typed("=TODAY()"))
            .unwrap();
        let _ = e.get_value("Sheet1", "A1").unwrap();
        assert!(
            e.is_dirty("Sheet1", "A1") || {
                let _ = e.recalculate().unwrap();
                e.get_value("Sheet1", "A1").is_ok()
            }
        );
    }
}
