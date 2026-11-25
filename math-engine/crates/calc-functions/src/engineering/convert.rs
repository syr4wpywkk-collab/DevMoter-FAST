//! `CONVERT(number, from_unit, to_unit)` — unit conversion across the
//! Excel measurement catalog. Spec: `docs/functions/CONVERT.md`.
//!
//! The table below is the ~Excel 2013/365 unit set (SPEC-OPEN: which
//! vintage to pin — this file covers the documented 2013+ additions:
//! `ly`, `Pica`/`Picapt`, `PS`, `bit`/`byte` + binary prefixes, speed,
//! area, `Rank`, `Reau`, `survey_mi`, `uk_*` imperial units). Unit
//! codes are case-sensitive (`"g"` gram vs `"G"` prefix giga).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cat {
    Mass,
    Dist,
    Time,
    Press,
    Force,
    Energy,
    Power,
    Mag,
    Vol,
    Area,
    Info,
    Speed,
}

/// Which prefixes may precede the unit code.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Prefix {
    /// No prefixes accepted.
    No,
    /// SI decimal prefixes (`k`, `M`, `da`, ...).
    Metric,
    /// SI decimal prefixes plus IEC binary prefixes (`Ki`, `Mi`, ...).
    MetricAndBinary,
}

/// A linear unit: `factor` converts to the category's base unit.
struct Unit {
    code: &'static str,
    cat: Cat,
    factor: f64,
    prefix: Prefix,
}

use Cat::*;
use Prefix::*;

/// Linear units (factor -> base unit of the category). Base units:
/// gram, meter, second, pascal, newton, joule, watt, tesla, liter,
/// square meter, bit, meter/second.
const UNITS: &[Unit] = &[
    // Weight & mass (base: gram)
    Unit {
        code: "g",
        cat: Mass,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "sg",
        cat: Mass,
        factor: 14593.9029372,
        prefix: No,
    },
    Unit {
        code: "lbm",
        cat: Mass,
        factor: 453.59237,
        prefix: No,
    },
    Unit {
        code: "u",
        cat: Mass,
        factor: 1.66053906660e-24,
        prefix: No,
    },
    Unit {
        code: "ozm",
        cat: Mass,
        factor: 28.349523125,
        prefix: No,
    },
    Unit {
        code: "grain",
        cat: Mass,
        factor: 0.06479891,
        prefix: No,
    },
    Unit {
        code: "cwt",
        cat: Mass,
        factor: 45359.237,
        prefix: No,
    },
    Unit {
        code: "uk_cwt",
        cat: Mass,
        factor: 50802.34544,
        prefix: No,
    },
    Unit {
        code: "stone",
        cat: Mass,
        factor: 6350.29318,
        prefix: No,
    },
    Unit {
        code: "ton",
        cat: Mass,
        factor: 907184.74,
        prefix: No,
    },
    Unit {
        code: "uk_ton",
        cat: Mass,
        factor: 1016046.9088,
        prefix: No,
    },
    // Distance (base: meter)
    Unit {
        code: "m",
        cat: Dist,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "mi",
        cat: Dist,
        factor: 1609.344,
        prefix: No,
    },
    Unit {
        code: "Nmi",
        cat: Dist,
        factor: 1852.0,
        prefix: No,
    },
    Unit {
        code: "in",
        cat: Dist,
        factor: 0.0254,
        prefix: No,
    },
    Unit {
        code: "ft",
        cat: Dist,
        factor: 0.3048,
        prefix: No,
    },
    Unit {
        code: "yd",
        cat: Dist,
        factor: 0.9144,
        prefix: No,
    },
    Unit {
        code: "ang",
        cat: Dist,
        factor: 1e-10,
        prefix: Metric,
    },
    Unit {
        code: "pc",
        cat: Dist,
        factor: 3.085_677_581_491_367e16,
        prefix: No,
    },
    Unit {
        code: "ly",
        cat: Dist,
        factor: 9.4607304725808e15,
        prefix: Metric,
    },
    Unit {
        code: "Pica",
        cat: Dist,
        factor: 0.00035277777777777776,
        prefix: No,
    },
    Unit {
        code: "Picapt",
        cat: Dist,
        factor: 0.00035277777777777776,
        prefix: No,
    },
    Unit {
        code: "survey_mi",
        cat: Dist,
        factor: 1609.3472186944375,
        prefix: No,
    },
    // Time (base: second)
    Unit {
        code: "yr",
        cat: Time,
        factor: 31557600.0,
        prefix: No,
    },
    Unit {
        code: "day",
        cat: Time,
        factor: 86400.0,
        prefix: No,
    },
    Unit {
        code: "hr",
        cat: Time,
        factor: 3600.0,
        prefix: No,
    },
    Unit {
        code: "mn",
        cat: Time,
        factor: 60.0,
        prefix: No,
    },
    Unit {
        code: "sec",
        cat: Time,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "s",
        cat: Time,
        factor: 1.0,
        prefix: Metric,
    },
    // Pressure (base: pascal)
    Unit {
        code: "Pa",
        cat: Press,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "p",
        cat: Press,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "atm",
        cat: Press,
        factor: 101325.0,
        prefix: No,
    },
    Unit {
        code: "at",
        cat: Press,
        factor: 101325.0,
        prefix: No,
    },
    Unit {
        code: "mmHg",
        cat: Press,
        factor: 133.322387415,
        prefix: No,
    },
    Unit {
        code: "psi",
        cat: Press,
        factor: 6894.757293168361,
        prefix: No,
    },
    Unit {
        code: "Torr",
        cat: Press,
        factor: 133.32236842105263,
        prefix: No,
    },
    // Force (base: newton)
    Unit {
        code: "N",
        cat: Force,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "dyn",
        cat: Force,
        factor: 1e-5,
        prefix: Metric,
    },
    Unit {
        code: "dy",
        cat: Force,
        factor: 1e-5,
        prefix: Metric,
    },
    Unit {
        code: "lbf",
        cat: Force,
        factor: 4.4482216152605,
        prefix: No,
    },
    Unit {
        code: "pond",
        cat: Force,
        factor: 0.00980665,
        prefix: No,
    },
    // Energy (base: joule)
    Unit {
        code: "J",
        cat: Energy,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "e",
        cat: Energy,
        factor: 1e-7,
        prefix: Metric,
    },
    Unit {
        code: "c",
        cat: Energy,
        factor: 4.184,
        prefix: Metric,
    },
    Unit {
        code: "cal",
        cat: Energy,
        factor: 4.1868,
        prefix: Metric,
    },
    Unit {
        code: "eV",
        cat: Energy,
        factor: 1.602176634e-19,
        prefix: Metric,
    },
    Unit {
        code: "ev",
        cat: Energy,
        factor: 1.602176634e-19,
        prefix: Metric,
    },
    Unit {
        code: "HPh",
        cat: Energy,
        factor: 2_684_519.537_696_173,
        prefix: Metric,
    },
    Unit {
        code: "hh",
        cat: Energy,
        factor: 2_684_519.537_696_173,
        prefix: Metric,
    },
    Unit {
        code: "Wh",
        cat: Energy,
        factor: 3600.0,
        prefix: Metric,
    },
    Unit {
        code: "wh",
        cat: Energy,
        factor: 3600.0,
        prefix: Metric,
    },
    Unit {
        code: "flb",
        cat: Energy,
        factor: 1.3558179483314004,
        prefix: No,
    },
    Unit {
        code: "BTU",
        cat: Energy,
        factor: 1055.05585262,
        prefix: No,
    },
    Unit {
        code: "btu",
        cat: Energy,
        factor: 1055.05585262,
        prefix: No,
    },
    // Power (base: watt)
    Unit {
        code: "W",
        cat: Power,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "w",
        cat: Power,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "HP",
        cat: Power,
        factor: 745.6998715822702,
        prefix: No,
    },
    Unit {
        code: "h",
        cat: Power,
        factor: 745.6998715822702,
        prefix: No,
    },
    Unit {
        code: "PS",
        cat: Power,
        factor: 735.49875,
        prefix: No,
    },
    // Magnetism (base: tesla)
    Unit {
        code: "T",
        cat: Mag,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "ga",
        cat: Mag,
        factor: 1e-4,
        prefix: Metric,
    },
    // Volume (base: liter)
    Unit {
        code: "tsp",
        cat: Vol,
        factor: 0.00492892159375,
        prefix: No,
    },
    Unit {
        code: "tspm",
        cat: Vol,
        factor: 0.00492892159375,
        prefix: No,
    },
    Unit {
        code: "tbs",
        cat: Vol,
        factor: 0.01478676478125,
        prefix: No,
    },
    Unit {
        code: "tbsm",
        cat: Vol,
        factor: 0.01478676478125,
        prefix: No,
    },
    Unit {
        code: "oz",
        cat: Vol,
        factor: 0.0295735295625,
        prefix: No,
    },
    Unit {
        code: "cup",
        cat: Vol,
        factor: 0.2365882365,
        prefix: No,
    },
    Unit {
        code: "pt",
        cat: Vol,
        factor: 0.473176473,
        prefix: No,
    },
    Unit {
        code: "us_pt",
        cat: Vol,
        factor: 0.473176473,
        prefix: No,
    },
    Unit {
        code: "uk_pt",
        cat: Vol,
        factor: 0.56826125,
        prefix: No,
    },
    Unit {
        code: "qt",
        cat: Vol,
        factor: 0.946352946,
        prefix: No,
    },
    Unit {
        code: "uk_qt",
        cat: Vol,
        factor: 1.1365225,
        prefix: No,
    },
    Unit {
        code: "gal",
        cat: Vol,
        factor: 3.785411784,
        prefix: No,
    },
    Unit {
        code: "uk_gal",
        cat: Vol,
        factor: 4.54609,
        prefix: No,
    },
    Unit {
        code: "l",
        cat: Vol,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "lt",
        cat: Vol,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "L",
        cat: Vol,
        factor: 1.0,
        prefix: Metric,
    },
    // Cubic measures (SPEC-OPEN: Excel 365 spells these "m3"-style;
    // whether caret forms like "m^3" are also accepted is unconfirmed).
    Unit {
        code: "m3",
        cat: Vol,
        factor: 1000.0,
        prefix: Metric,
    },
    Unit {
        code: "in3",
        cat: Vol,
        factor: 0.016387064,
        prefix: No,
    },
    Unit {
        code: "ft3",
        cat: Vol,
        factor: 28.316846592,
        prefix: No,
    },
    Unit {
        code: "yd3",
        cat: Vol,
        factor: 764.554857984,
        prefix: No,
    },
    Unit {
        code: "mi3",
        cat: Vol,
        factor: 4168181825.4405,
        prefix: No,
    },
    Unit {
        code: "Nmi3",
        cat: Vol,
        factor: 6352182208.0,
        prefix: No,
    },
    Unit {
        code: "ly3",
        cat: Vol,
        factor: 8.466588e50,
        prefix: No,
    },
    Unit {
        code: "barrel",
        cat: Vol,
        factor: 158.987294928,
        prefix: No,
    },
    Unit {
        code: "bushel",
        cat: Vol,
        factor: 35.23907016688,
        prefix: No,
    },
    Unit {
        code: "gill",
        cat: Vol,
        factor: 0.11829411825,
        prefix: No,
    },
    Unit {
        code: "uk_gill",
        cat: Vol,
        factor: 0.1420653125,
        prefix: No,
    },
    Unit {
        code: "regton",
        cat: Vol,
        factor: 2831.6846592,
        prefix: No,
    },
    // Area (base: square meter)
    Unit {
        code: "m2",
        cat: Area,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "in2",
        cat: Area,
        factor: 0.00064516,
        prefix: No,
    },
    Unit {
        code: "ft2",
        cat: Area,
        factor: 0.09290304,
        prefix: No,
    },
    Unit {
        code: "yd2",
        cat: Area,
        factor: 0.83612736,
        prefix: No,
    },
    Unit {
        code: "mi2",
        cat: Area,
        factor: 2589988.110336,
        prefix: No,
    },
    Unit {
        code: "Nmi2",
        cat: Area,
        factor: 3429904.0,
        prefix: No,
    },
    Unit {
        code: "ly2",
        cat: Area,
        factor: 8.9505421e31,
        prefix: No,
    },
    Unit {
        code: "ang2",
        cat: Area,
        factor: 1e-20,
        prefix: Metric,
    },
    Unit {
        code: "ar",
        cat: Area,
        factor: 100.0,
        prefix: Metric,
    },
    Unit {
        code: "ha",
        cat: Area,
        factor: 10000.0,
        prefix: No,
    },
    Unit {
        code: "uk_acre",
        cat: Area,
        factor: 4046.8564224,
        prefix: No,
    },
    Unit {
        code: "us_acre",
        cat: Area,
        factor: 4046.872609874252,
        prefix: No,
    },
    Unit {
        code: "Morgen",
        cat: Area,
        factor: 2500.0,
        prefix: No,
    },
    // Information (base: bit)
    Unit {
        code: "bit",
        cat: Info,
        factor: 1.0,
        prefix: MetricAndBinary,
    },
    Unit {
        code: "byte",
        cat: Info,
        factor: 8.0,
        prefix: MetricAndBinary,
    },
    // Speed (base: meter/second)
    Unit {
        code: "admkn",
        cat: Speed,
        factor: 0.5144444444444444,
        prefix: No,
    },
    Unit {
        code: "kn",
        cat: Speed,
        factor: 0.5144444444444444,
        prefix: No,
    },
    Unit {
        code: "m/h",
        cat: Speed,
        factor: 1.0 / 3600.0,
        prefix: Metric,
    },
    Unit {
        code: "m/hr",
        cat: Speed,
        factor: 1.0 / 3600.0,
        prefix: Metric,
    },
    Unit {
        code: "m/s",
        cat: Speed,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "m/sec",
        cat: Speed,
        factor: 1.0,
        prefix: Metric,
    },
    Unit {
        code: "mph",
        cat: Speed,
        factor: 0.44704,
        prefix: No,
    },
];

/// SI decimal prefixes (checked longest-first so `"da"` wins over `"d"`).
const METRIC_PREFIXES: &[(&str, f64)] = &[
    ("da", 1e1),
    ("Y", 1e24),
    ("Z", 1e21),
    ("E", 1e18),
    ("P", 1e15),
    ("T", 1e12),
    ("G", 1e9),
    ("M", 1e6),
    ("k", 1e3),
    ("h", 1e2),
    ("d", 1e-1),
    ("c", 1e-2),
    ("m", 1e-3),
    ("u", 1e-6),
    ("\u{00B5}", 1e-6),
    ("\u{03BC}", 1e-6),
    ("n", 1e-9),
    ("p", 1e-12),
    ("f", 1e-15),
    ("a", 1e-18),
    ("z", 1e-21),
    ("y", 1e-24),
];

/// IEC binary prefixes, valid on `bit`/`byte` only.
const BINARY_PREFIXES: &[(&str, f64)] = &[
    ("Ki", 1024.0),
    ("Mi", 1048576.0),
    ("Gi", 1073741824.0),
    ("Ti", 1099511627776.0),
    ("Pi", 1125899906842624.0),
    ("Ei", 1152921504606846976.0),
    ("Zi", 1180591620717411303424.0),
    ("Yi", 1208925819614629174706176.0),
];

/// Temperature unit — affine conversion routed through Celsius.
#[derive(Clone, Copy)]
enum Temp {
    C,
    F,
    K,
    Rank,
    Reau,
}

impl Temp {
    fn to_celsius(self, v: f64) -> f64 {
        match self {
            Temp::C => v,
            Temp::F => (v - 32.0) * (5.0 / 9.0),
            Temp::K => v - 273.15,
            Temp::Rank => (v - 491.67) * (5.0 / 9.0),
            Temp::Reau => v * 1.25,
        }
    }

    fn celsius_to(self, c: f64) -> f64 {
        match self {
            Temp::C => c,
            Temp::F => c * (9.0 / 5.0) + 32.0,
            Temp::K => c + 273.15,
            Temp::Rank => (c + 273.15) * (9.0 / 5.0),
            Temp::Reau => c * 0.8,
        }
    }
}

fn temp_unit(code: &str) -> Option<Temp> {
    Some(match code {
        "C" | "cel" => Temp::C,
        "F" | "fah" => Temp::F,
        "K" | "kel" => Temp::K,
        "Rank" => Temp::Rank,
        "Reau" => Temp::Reau,
        _ => return None,
    })
}

enum Resolved {
    Temp(Temp),
    Linear(Cat, f64),
}

/// Resolve a unit code (case-sensitive) to either a temperature unit
/// or `(category, factor-to-base)`, applying one metric or binary
/// prefix where the base unit allows it.
fn resolve(code: &str) -> Option<Resolved> {
    if let Some(t) = temp_unit(code) {
        return Some(Resolved::Temp(t));
    }
    if let Some(u) = UNITS.iter().find(|u| u.code == code) {
        return Some(Resolved::Linear(u.cat, u.factor));
    }
    // Prefix + unit. The remainder must itself be a prefixable *base*
    // unit, so `"kkg"` fails (`"kg"` is not a table entry).
    for (p, pf) in METRIC_PREFIXES {
        if let Some(rest) = code.strip_prefix(p) {
            if let Some(u) = UNITS.iter().find(|u| u.code == rest) {
                if u.prefix == Metric || u.prefix == MetricAndBinary {
                    return Some(Resolved::Linear(u.cat, u.factor * pf));
                }
            }
        }
    }
    for (p, pf) in BINARY_PREFIXES {
        if let Some(rest) = code.strip_prefix(p) {
            if let Some(u) = UNITS.iter().find(|u| u.code == rest) {
                if u.prefix == MetricAndBinary {
                    return Some(Resolved::Linear(u.cat, u.factor * pf));
                }
            }
        }
    }
    None
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let n = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let from = match ctx.eval(&args[1])?.to_text() {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let to = match ctx.eval(&args[2])?.to_text() {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let (Some(f), Some(t)) = (resolve(&from), resolve(&to)) else {
        return Ok(Value::Error(CalcError::NA));
    };
    let result = match (f, t) {
        (Resolved::Temp(a), Resolved::Temp(b)) => b.celsius_to(a.to_celsius(n)),
        (Resolved::Linear(ca, fa), Resolved::Linear(cb, fb)) if ca == cb => n * fa / fb,
        _ => return Ok(Value::Error(CalcError::NA)),
    };
    Ok(Value::Number(result))
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

    fn close(got: &Value, want: f64) {
        let g = n(got);
        assert!(
            (g - want).abs() <= 1e-9_f64.max(want.abs() * 1e-9),
            "got {g}, want {want}"
        );
    }

    #[test]
    fn spec_examples() {
        close(&eval(r#"=CONVERT(1,"lbm","kg")"#), 0.45359237);
        close(&eval(r#"=CONVERT(68,"F","C")"#), 20.0);
        assert_eq!(e(&eval(r#"=CONVERT(2.5,"ft","sec")"#)), CalcError::NA);
        close(&eval(r#"=CONVERT(100,"m","km")"#), 0.1);
        close(&eval(r#"=CONVERT(1,"gal","l")"#), 3.785411784);
        close(&eval(r#"=CONVERT(1,"C","K")"#), 274.15);
    }

    #[test]
    fn distance() {
        close(&eval(r#"=CONVERT(1,"mi","m")"#), 1609.344);
        close(&eval(r#"=CONVERT(12,"in","ft")"#), 1.0);
        close(&eval(r#"=CONVERT(1,"Nmi","m")"#), 1852.0);
    }

    #[test]
    fn mass() {
        close(&eval(r#"=CONVERT(1,"kg","g")"#), 1000.0);
        close(&eval(r#"=CONVERT(16,"ozm","lbm")"#), 1.0);
        close(&eval(r#"=CONVERT(1,"ton","lbm")"#), 2000.0);
    }

    #[test]
    fn temperature() {
        close(&eval(r#"=CONVERT(212,"F","C")"#), 100.0);
        close(&eval(r#"=CONVERT(0,"C","F")"#), 32.0);
        close(&eval(r#"=CONVERT(300,"K","C")"#), 26.85);
        close(&eval(r#"=CONVERT(0,"K","F")"#), -459.67);
    }

    #[test]
    fn metric_prefixes() {
        close(&eval(r#"=CONVERT(1,"km","mi")"#), 0.621371192237334);
        close(&eval(r#"=CONVERT(1,"Ml","l")"#), 1e6);
        close(&eval(r#"=CONVERT(500,"mg","g")"#), 0.5);
        close(&eval(r#"=CONVERT(2,"dam","m")"#), 20.0);
    }

    #[test]
    fn energy_power() {
        close(&eval(r#"=CONVERT(1,"Wh","J")"#), 3600.0);
        close(&eval(r#"=CONVERT(1,"HP","W")"#), 745.6998715822702);
        close(&eval(r#"=CONVERT(1,"cal","J")"#), 4.1868);
    }

    #[test]
    fn information() {
        close(&eval(r#"=CONVERT(1,"byte","bit")"#), 8.0);
        close(&eval(r#"=CONVERT(1,"Kibyte","byte")"#), 1024.0);
        close(&eval(r#"=CONVERT(1,"Mibit","bit")"#), 1048576.0);
        close(&eval(r#"=CONVERT(1,"kbit","bit")"#), 1000.0);
    }

    #[test]
    fn speed() {
        close(&eval(r#"=CONVERT(60,"mph","m/s")"#), 26.8224);
        close(&eval(r#"=CONVERT(1,"kn","m/s")"#), 0.5144444444444444);
    }

    #[test]
    fn unknown_unit_na() {
        assert_eq!(e(&eval(r#"=CONVERT(1,"zzz","m")"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=CONVERT(1,"m","zzz")"#)), CalcError::NA);
    }

    #[test]
    fn invalid_prefix_na() {
        // Prefix on a non-prefixable unit -> #N/A.
        assert_eq!(e(&eval(r#"=CONVERT(1,"kmi","m")"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=CONVERT(1,"kF","C")"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=CONVERT(1,"kkg","g")"#)), CalcError::NA);
    }

    #[test]
    fn case_sensitive() {
        // "G" is the giga prefix, not grams.
        assert_eq!(e(&eval(r#"=CONVERT(1,"G","g")"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=CONVERT(1,"KG","g")"#)), CalcError::NA);
    }

    #[test]
    fn text_number_coerces() {
        // SPEC-OPEN: text number coercion (expected: coerces).
        close(&eval(r#"=CONVERT("100","m","km")"#), 0.1);
    }

    #[test]
    fn bad_number_value_error() {
        assert_eq!(e(&eval(r#"=CONVERT("x","m","km")"#)), CalcError::Value);
    }

    #[test]
    fn volume() {
        close(&eval(r#"=CONVERT(1,"m3","l")"#), 1000.0);
        close(&eval(r#"=CONVERT(1,"uk_pt","pt")"#), 1.2009499255);
    }

    #[test]
    fn blank_ref_is_zero() {
        close(&eval(r#"=CONVERT(A1,"F","C")"#), -17.7777777778);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=CONVERT(1/0,"m","km")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=CONVERT(1,1/0,"m")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=CONVERT(1,"m")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=CONVERT(1,"m","km","x")"#)), CalcError::Value);
    }
}
