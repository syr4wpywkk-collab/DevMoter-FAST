//! `ROMAN(number, [form])` — Arabic numeral to Roman numeral text.
//! Spec: `docs/functions/ROMAN.md`.
//!
//! `form` selects how many subtractive shortcut pairs are allowed,
//! cumulative per the documented precedence relaxations (Google/Excel
//! behavior): form 0 allows only the classic pairs (IV IX XL XC CD CM);
//! form 1 adds VL VC LD LM; form 2 adds IL IC XD XM; form 3 adds VD VM;
//! form 4 adds ID IM. Greedy largest-first decomposition reproduces the
//! documented examples (499 -> CDXCIX/LDVLIV/XDIX/VDIV/ID; 999 ->
//! CMXCIX/LMVLIV/XMIX/VMIV/IM).
//!
//! `TRUE` maps to form 0 and `FALSE` to form 4 (they must not go through
//! the numeric coercion, which would give 1/0).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// (value, numeral) pairs, descending; each form's table extends the
/// previous one's shortcuts.
const TOKENS: [&[(u32, &str)]; 5] = [
    &[
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ],
    &[
        (1000, "M"),
        (950, "LM"),
        (900, "CM"),
        (500, "D"),
        (450, "LD"),
        (400, "CD"),
        (100, "C"),
        (95, "VC"),
        (90, "XC"),
        (50, "L"),
        (45, "VL"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ],
    &[
        (1000, "M"),
        (990, "XM"),
        (950, "LM"),
        (900, "CM"),
        (500, "D"),
        (490, "XD"),
        (450, "LD"),
        (400, "CD"),
        (100, "C"),
        (99, "IC"),
        (95, "VC"),
        (90, "XC"),
        (50, "L"),
        (49, "IL"),
        (45, "VL"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ],
    &[
        (1000, "M"),
        (995, "VM"),
        (990, "XM"),
        (950, "LM"),
        (900, "CM"),
        (500, "D"),
        (495, "VD"),
        (490, "XD"),
        (450, "LD"),
        (400, "CD"),
        (100, "C"),
        (99, "IC"),
        (95, "VC"),
        (90, "XC"),
        (50, "L"),
        (49, "IL"),
        (45, "VL"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ],
    &[
        (1000, "M"),
        (999, "IM"),
        (995, "VM"),
        (990, "XM"),
        (950, "LM"),
        (900, "CM"),
        (500, "D"),
        (499, "ID"),
        (495, "VD"),
        (490, "XD"),
        (450, "LD"),
        (400, "CD"),
        (100, "C"),
        (99, "IC"),
        (95, "VC"),
        (90, "XC"),
        (50, "L"),
        (49, "IL"),
        (45, "VL"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ],
];

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let num = match ctx.eval(&args[0])?.to_number() {
        Ok(n) if n.is_finite() => n.trunc(),
        Ok(_) => return Ok(Value::Error(CalcError::Num)),
        Err(e) => return Ok(Value::Error(e)),
    };
    if !(0.0..=3999.0).contains(&num) {
        return Ok(Value::Error(CalcError::Value));
    }
    let form = match args.get(1) {
        None => 0usize,
        Some(expr) => match ctx.eval(expr)? {
            // Booleans select the extremes, not 1/0.
            Value::Boolean(true) => 0,
            Value::Boolean(false) => 4,
            v => match v.to_number() {
                Ok(f) if f.is_finite() => {
                    let f = f.trunc();
                    if !(0.0..=4.0).contains(&f) {
                        return Ok(Value::Error(CalcError::Value));
                    }
                    f as usize
                }
                Ok(_) => return Ok(Value::Error(CalcError::Num)),
                Err(e) => return Ok(Value::Error(e)),
            },
        },
    };

    let mut n = num as u32;
    let mut out = String::new();
    for &(v, s) in TOKENS[form] {
        while n >= v {
            out.push_str(s);
            n -= v;
        }
    }
    // n == 0 terminates; 0 input yields the empty string.
    Ok(Value::Text(out))
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
    fn classic_499() {
        assert_eq!(t(&eval("=ROMAN(499)")), "CDXCIX");
    }

    #[test]
    fn documented_forms_499() {
        assert_eq!(t(&eval("=ROMAN(499,0)")), "CDXCIX");
        assert_eq!(t(&eval("=ROMAN(499,1)")), "LDVLIV");
        assert_eq!(t(&eval("=ROMAN(499,2)")), "XDIX");
        assert_eq!(t(&eval("=ROMAN(499,3)")), "VDIV");
        assert_eq!(t(&eval("=ROMAN(499,4)")), "ID");
    }

    #[test]
    fn documented_forms_999() {
        assert_eq!(t(&eval("=ROMAN(999,0)")), "CMXCIX");
        assert_eq!(t(&eval("=ROMAN(999,1)")), "LMVLIV");
        assert_eq!(t(&eval("=ROMAN(999,2)")), "XMIX");
        assert_eq!(t(&eval("=ROMAN(999,3)")), "VMIV");
        assert_eq!(t(&eval("=ROMAN(999,4)")), "IM");
    }

    #[test]
    fn year_2013() {
        assert_eq!(t(&eval("=ROMAN(2013)")), "MMXIII");
    }

    #[test]
    fn zero_empty_string() {
        assert_eq!(t(&eval("=ROMAN(0)")), "");
    }

    #[test]
    fn boundary_3999() {
        assert_eq!(t(&eval("=ROMAN(3999)")), "MMMCMXCIX");
    }

    #[test]
    fn non_integer_truncated() {
        assert_eq!(t(&eval("=ROMAN(499.9)")), "CDXCIX");
    }

    #[test]
    fn bool_form() {
        // TRUE -> classic, FALSE -> simplified.
        assert_eq!(t(&eval("=ROMAN(499,TRUE)")), "CDXCIX");
        assert_eq!(t(&eval("=ROMAN(499,FALSE)")), "ID");
    }

    #[test]
    fn out_of_range() {
        assert_eq!(e(&eval("=ROMAN(-1)")), CalcError::Value);
        assert_eq!(e(&eval("=ROMAN(4000)")), CalcError::Value);
    }

    #[test]
    fn form_out_of_range() {
        assert_eq!(e(&eval("=ROMAN(10,5)")), CalcError::Value);
        assert_eq!(e(&eval("=ROMAN(10,-1)")), CalcError::Value);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(t(&eval("=ROMAN(\"58\")")), "LVIII");
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=ROMAN(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ROMAN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ROMAN()")), CalcError::Value);
        assert_eq!(e(&eval("=ROMAN(1,2,3)")), CalcError::Value);
    }
}
