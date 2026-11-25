//! `BAHTTEXT(number)` — converts a number to Thai text expressing the
//! amount in baht currency. Spec: `docs/functions/BAHTTEXT.md`.
//!
//! The integer part is spelled out in Thai number words followed by
//! `บาท`; the fractional part (rounded half away from zero to 2
//! decimals) is spelled out as satang. Zero satang appends `ถ้วน`.
//! A zero baht part with nonzero satang omits the baht phrase.
//! Negative numbers are rendered `ลบ` + the positive spelling
//! (SPEC-OPEN — the spec doc reports divergent Excel behaviors).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

const DIGITS: [&str; 10] = [
    "",
    "หนึ่ง",
    "สอง",
    "สาม",
    "สี่",
    "ห้า",
    "หก",
    "เจ็ด",
    "แปด",
    "เก้า",
];
const PLACES: [&str; 6] = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/// Spell a group value in `1..=999_999` in Thai number words.
fn spell_group(v: u64) -> String {
    debug_assert!((1..=999_999).contains(&v));
    let mut out = String::new();
    let d = [
        (v / 100_000) % 10,
        (v / 10_000) % 10,
        (v / 1_000) % 10,
        (v / 100) % 10,
        (v / 10) % 10,
        v % 10,
    ];
    // d[0] is the แสน digit, d[5] the ones digit.
    for (i, &digit) in d.iter().enumerate().take(4) {
        if digit != 0 {
            out.push_str(DIGITS[digit as usize]);
            out.push_str(PLACES[5 - i]);
        }
    }
    match d[4] {
        0 => {}
        1 => out.push_str("สิบ"),
        2 => out.push_str("ยี่สิบ"),
        n => {
            out.push_str(DIGITS[n as usize]);
            out.push_str("สิบ");
        }
    }
    match d[5] {
        0 => {}
        // Ones digit 1 is เอ็ด when higher digits precede it in the
        // group (SPEC-OPEN across ล้าน boundaries).
        1 if v > 10 => out.push_str("เอ็ด"),
        n => out.push_str(DIGITS[n as usize]),
    }
    out
}

/// Spell a non-negative integer in Thai number words.
fn spell(mut n: u64) -> String {
    if n == 0 {
        return "ศูนย์".to_string();
    }
    let mut groups = Vec::new();
    while n > 0 {
        groups.push(n % 1_000_000);
        n /= 1_000_000;
    }
    let mut out = String::new();
    for (rank, &g) in groups.iter().enumerate().rev() {
        if g == 0 {
            continue;
        }
        out.push_str(&spell_group(g));
        out.push_str(&"ล้าน".repeat(rank));
    }
    out
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let n = match coercion::eval_number(ctx, &args[0])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !n.is_finite() || n.abs() >= 1e18 {
        // Beyond u64 precision the Thai place-value table cannot
        // spell the number exactly (SPEC-OPEN: Excel's overflow
        // behavior is undocumented).
        return Ok(Value::Error(CalcError::Num));
    }
    let neg = n < 0.0;
    // Satang rounding: half away from zero on the cent value.
    let cents = (n.abs() * 100.0).round() as u64;
    let (baht, satang) = (cents / 100, cents % 100);
    let mut out = String::new();
    if neg {
        out.push_str("ลบ");
    }
    if baht > 0 || satang == 0 {
        out.push_str(&spell(baht));
        out.push_str("บาท");
    }
    if satang == 0 {
        out.push_str("ถ้วน");
    } else {
        out.push_str(&spell(satang));
        out.push_str("สตางค์");
    }
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
    fn documented_example() {
        assert_eq!(t(&eval("=BAHTTEXT(1234)")), "หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน");
    }

    #[test]
    fn zero() {
        assert_eq!(t(&eval("=BAHTTEXT(0)")), "ศูนย์บาทถ้วน");
    }

    #[test]
    fn satang_only() {
        assert_eq!(t(&eval("=BAHTTEXT(0.5)")), "ห้าสิบสตางค์");
    }

    #[test]
    fn baht_and_satang() {
        assert_eq!(t(&eval("=BAHTTEXT(1.25)")), "หนึ่งบาทยี่สิบห้าสตางค์");
    }

    #[test]
    fn eleven_uses_et() {
        assert_eq!(t(&eval("=BAHTTEXT(11)")), "สิบเอ็ดบาทถ้วน");
        assert_eq!(t(&eval("=BAHTTEXT(21)")), "ยี่สิบเอ็ดบาทถ้วน");
    }

    #[test]
    fn million_group() {
        assert_eq!(t(&eval("=BAHTTEXT(1000000)")), "หนึ่งล้านบาทถ้วน");
        assert_eq!(
            t(&eval("=BAHTTEXT(1234567)")),
            "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน"
        );
    }

    #[test]
    fn satang_rounding() {
        assert_eq!(t(&eval("=BAHTTEXT(1.03)")), "หนึ่งบาทสามสตางค์");
        assert_eq!(t(&eval("=BAHTTEXT(1.004)")), "หนึ่งบาทถ้วน");
        assert_eq!(t(&eval("=BAHTTEXT(1.999)")), "สองบาทถ้วน");
    }

    #[test]
    fn negative() {
        assert_eq!(t(&eval("=BAHTTEXT(-1)")), "ลบหนึ่งบาทถ้วน");
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(t(&eval(r#"=BAHTTEXT("5")"#)), "ห้าบาทถ้วน");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=BAHTTEXT(TRUE)")), "หนึ่งบาทถ้วน");
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=BAHTTEXT(A1)")), "ศูนย์บาทถ้วน");
    }

    #[test]
    fn nonnumeric_is_value_error() {
        assert_eq!(e(&eval(r#"=BAHTTEXT("abc")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BAHTTEXT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn huge_magnitude_is_num_error() {
        assert_eq!(e(&eval("=BAHTTEXT(1e18)")), CalcError::Num);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BAHTTEXT()")), CalcError::Value);
        assert_eq!(e(&eval("=BAHTTEXT(1,2)")), CalcError::Value);
    }
}
