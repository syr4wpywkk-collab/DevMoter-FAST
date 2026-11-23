//! `ISREF(value)` — TRUE when `value` is a cell or range reference. A
//! text string that merely looks like a reference is not one.
//! SPEC-OPEN: a `#REF!` result propagates as an error rather than
//! returning FALSE/TRUE. Spec: `docs/functions/ISREF.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval_ref(&args[0])? {
        Ok(_) => Ok(Value::Boolean(true)),
        // `#VALUE!` here means "evaluated, but not a reference value" —
        // unless the argument itself evaluated to a real `#VALUE!`
        // error, which propagates.
        Err(CalcError::Value) => match ctx.eval(&args[0])? {
            Value::Error(e) => Ok(Value::Error(e)),
            _ => Ok(Value::Boolean(false)),
        },
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn b(v: &Value) -> bool {
        match v {
            Value::Boolean(b) => *b,
            o => panic!("expected bool, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn cell_ref_true() {
        assert!(b(&eval("=ISREF(A1)")));
        assert!(b(&eval("=ISREF($C$5)")));
    }

    #[test]
    fn range_ref_true() {
        assert!(b(&eval("=ISREF(A1:B2)")));
        assert!(b(&eval("=ISREF(A1:B5)")));
    }

    #[test]
    fn other_sheet_ref_true() {
        assert!(b(&eval("=ISREF(Sheet1!A1)")));
    }

    #[test]
    fn text_not_ref() {
        assert!(!b(&eval(r#"=ISREF("A1")"#)));
        assert!(!b(&eval(r#"=ISREF("")"#)));
    }

    #[test]
    fn scalars_false() {
        assert!(!b(&eval("=ISREF(5)")));
        assert!(!b(&eval("=ISREF(1+1)")));
        assert!(!b(&eval("=ISREF(TRUE)")));
        assert!(!b(&eval("=ISREF(ABS(-2))")));
    }

    #[test]
    fn missing_sheet_propagates() {
        // SPEC-OPEN: unresolvable reference propagates `#REF!`.
        assert_eq!(e(&eval("=ISREF(Nosuch!A1)")), CalcError::Ref);
    }

    #[test]
    fn ref_literal_propagates() {
        // SPEC-OPEN: Excel may treat `#REF!` as a (broken) reference;
        // here the error propagates like other error arguments.
        assert_eq!(e(&eval("=ISREF(#REF!)")), CalcError::Ref);
    }

    #[test]
    fn other_errors_propagate() {
        assert_eq!(e(&eval("=ISREF(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISREF(NA())")), CalcError::NA);
        assert_eq!(e(&eval("=ISREF(#VALUE!)")), CalcError::Value);
    }

    #[test]
    fn in_if_guard() {
        assert_eq!(
            eval(r#"=IF(ISREF(A1),"ref","val")"#),
            Value::Text("ref".into())
        );
        assert_eq!(
            eval(r#"=IF(ISREF(3),"ref","val")"#),
            Value::Text("val".into())
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISREF()")), CalcError::Value);
        assert_eq!(e(&eval("=ISREF(A1,B1)")), CalcError::Value);
    }
}
