//! `STOCKHISTORY(stock, start_date, ...)` — historical market data.
//! Spec: `docs/functions/STOCKHISTORY.md`.
//!
//! NOT IMPLEMENTABLE OFFLINE: the function calls a cloud market-data
//! service and there is no local semantics to reproduce. The name is
//! registered so formulas parse; evaluation always returns `#N/A`
//! (documented stub per the spec's offline recommendation) — never a
//! fabricated price.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(_ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    // `stock` and `start_date` are required; remaining arguments are
    // optional. Wrong arity is `#VALUE!`; otherwise the defined
    // "external data unavailable" stub is `#N/A`.
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    Ok(Value::Error(CalcError::NA))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn always_na() {
        assert_eq!(
            e(&eval(r#"=STOCKHISTORY("MSFT",DATE(2024,1,1))"#)),
            CalcError::NA
        );
    }

    #[test]
    fn full_signature_na() {
        assert_eq!(
            e(&eval(
                r#"=STOCKHISTORY("XNAS:AAPL",DATE(2024,6,3),DATE(2024,6,7),0,1,0,1)"#
            )),
            CalcError::NA
        );
    }

    #[test]
    fn text_date_na() {
        assert_eq!(
            e(&eval(r#"=STOCKHISTORY("MSFT","2024-01-01")"#)),
            CalcError::NA
        );
    }

    #[test]
    fn too_few_args_value() {
        assert_eq!(e(&eval("=STOCKHISTORY()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=STOCKHISTORY("MSFT")"#)), CalcError::Value);
    }

    #[test]
    fn isna_of_result() {
        assert_eq!(
            eval(r#"=ISNA(STOCKHISTORY("MSFT",DATE(2024,1,1)))"#),
            Value::Boolean(true)
        );
    }

    #[test]
    fn iserror_of_result() {
        assert_eq!(
            eval(r#"=ISERROR(STOCKHISTORY("MSFT",DATE(2024,1,1)))"#),
            Value::Boolean(true)
        );
    }

    #[test]
    fn iserr_of_result_false() {
        // #N/A is excluded from ISERR — the stub composes like a real
        // #N/A, not like a hard failure.
        assert_eq!(
            eval(r#"=ISERR(STOCKHISTORY("MSFT",DATE(2024,1,1)))"#),
            Value::Boolean(false)
        );
    }

    #[test]
    fn error_type_seven() {
        assert_eq!(
            eval(r#"=ERROR.TYPE(STOCKHISTORY("MSFT",DATE(2024,1,1)))"#),
            Value::Number(7.0)
        );
    }

    #[test]
    fn propagates_as_na() {
        assert_eq!(
            e(&eval(r#"=STOCKHISTORY("MSFT",DATE(2024,1,1))+1"#)),
            CalcError::NA
        );
    }

    #[test]
    fn no_fabricated_values() {
        // The stub never returns data rows.
        assert!(matches!(
            eval(r#"=STOCKHISTORY("AAPL",44197)"#),
            Value::Error(CalcError::NA)
        ));
    }
}
