//! calc-cli: development CLI for evaluating formulas.
//!
//! Composes `calc-core` (engine) with `calc-functions` (standard
//! registry) — the composition root for the library crates (v2 §3).

use std::process::ExitCode;

use calc_core::{CalcEngine, EngineError, Value};

const USAGE: &str = "\
calc-cli — development CLI for the calc engine

USAGE:
    calc-cli <COMMAND>

COMMANDS:
    eval <FORMULA>   Evaluate a formula on an empty Sheet1 (with or without '=')
    help             Print this message
";

/// Outcome of parsing and dispatching a command line.
enum Outcome {
    /// Print to stdout, exit 0.
    Ok(String),
    /// Print to stderr, exit with the given code.
    Err(u8, String),
}

/// Engine with the standard function registry installed — the point
/// where calc-core and calc-functions are composed.
fn engine() -> CalcEngine {
    let mut e = CalcEngine::new();
    e.set_registry(Box::new(calc_functions::default_registry()));
    e.add_sheet("Sheet1").expect("fresh engine");
    e
}

fn run(args: &[String]) -> Outcome {
    match args.first().map(String::as_str) {
        None | Some("help") | Some("--help") | Some("-h") => Outcome::Ok(USAGE.to_string()),
        Some("eval") => match args.get(1) {
            None => Outcome::Err(
                2,
                "error: `eval` requires a <FORMULA> argument\n".to_string(),
            ),
            Some(formula) => match engine().eval_formula("Sheet1", formula) {
                Ok(v) => Outcome::Ok(render(&v)),
                Err(e) => Outcome::Err(3, error_message(formula, &e)),
            },
        },
        Some(other) => Outcome::Err(2, format!("error: unknown command `{other}`\n\n{USAGE}")),
    }
}

/// Rows of an array result printed before the rest is elided.
const MAX_ARRAY_ROWS: u32 = 50;

/// A scalar prints as itself; an array prints one row per line with
/// tab-separated cells, under a `<array RxC>` header.
fn render(v: &Value) -> String {
    let Value::Array(a) = v else {
        return format!("{v}\n");
    };
    let mut out = format!("<array {}x{}>\n", a.rows(), a.cols());
    for r in 0..a.rows().min(MAX_ARRAY_ROWS) {
        let row: Vec<String> = (0..a.cols())
            .map(|c| a.get(r, c).map(cell_text).unwrap_or_default())
            .collect();
        out.push_str(&row.join("\t"));
        out.push('\n');
    }
    if a.rows() > MAX_ARRAY_ROWS {
        out.push_str(&format!("... {} more rows\n", a.rows() - MAX_ARRAY_ROWS));
    }
    out
}

/// A cell's display text with `\\`, tab and line breaks escaped, so they
/// cannot be mistaken for the column and row separators.
fn cell_text(v: &Value) -> String {
    let mut out = String::new();
    for ch in v.to_string().chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c => out.push(c),
        }
    }
    out
}

/// A syntax error also gets its 1-based character column and a caret
/// under that position on the line where it occurs. The caret's indent
/// copies tabs and uses an ideographic space under wide (CJK) characters
/// so it lines up in a terminal.
fn error_message(formula: &str, e: &EngineError) -> String {
    let EngineError::Parse(p) = e else {
        return format!("error: {e}\n");
    };
    let Some(before) = formula.get(..p.offset) else {
        return format!("error: {e}\n");
    };
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let line_end = formula[p.offset..]
        .find(['\r', '\n'])
        .map_or(formula.len(), |i| p.offset + i);
    let indent: String = formula[line_start..p.offset]
        .chars()
        .map(|c| match c {
            '\t' => '\t',
            c if is_wide(c) => '\u{3000}',
            _ => ' ',
        })
        .collect();
    format!(
        "error: {e} (character {})\n  {}\n  {indent}^\n",
        before.chars().count() + 1,
        &formula[line_start..line_end],
    )
}

/// East Asian wide/fullwidth characters (two terminal columns).
fn is_wide(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x115F | 0x2E80..=0x303E | 0x3041..=0x33FF | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF | 0xA000..=0xA4CF | 0xAC00..=0xD7A3 | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F | 0xFF00..=0xFF60 | 0xFFE0..=0xFFE6
        | 0x1F300..=0x1F64F | 0x1F900..=0x1F9FF | 0x20000..=0x3FFFD)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Outcome::Ok(msg) => {
            print!("{msg}");
            ExitCode::SUCCESS
        }
        Outcome::Err(code, msg) => {
            eprint!("{msg}");
            ExitCode::from(code)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_args_prints_usage() {
        match run(&args(&[])) {
            Outcome::Ok(msg) => assert!(msg.contains("eval <FORMULA>")),
            Outcome::Err(..) => panic!("expected Ok"),
        }
    }

    #[test]
    fn eval_without_formula_is_usage_error() {
        match run(&args(&["eval"])) {
            Outcome::Err(2, msg) => assert!(msg.contains("requires a <FORMULA>")),
            _ => panic!("expected usage error"),
        }
    }

    #[test]
    fn eval_computes_with_standard_registry() {
        match run(&args(&["eval", "=SUM(1,2,3)+1"])) {
            Outcome::Ok(msg) => assert_eq!(msg, "7\n"),
            Outcome::Err(..) => panic!("expected evaluated result"),
        }
    }

    #[test]
    fn eval_error_is_reported() {
        match run(&args(&["eval", "=NOSUCHFN(1)"])) {
            Outcome::Ok(msg) => assert!(msg.contains("#NAME?")),
            Outcome::Err(..) => panic!("expected #NAME? value"),
        }
    }

    #[test]
    fn array_result_prints_its_cells() {
        match run(&args(&["eval", "=SEQUENCE(3)"])) {
            Outcome::Ok(msg) => assert_eq!(msg, "<array 3x1>\n1\n2\n3\n"),
            Outcome::Err(..) => panic!("expected array"),
        }
        match run(&args(&["eval", "={1,\"a\";TRUE,#N/A}"])) {
            Outcome::Ok(msg) => assert_eq!(msg, "<array 2x2>\n1\ta\nTRUE\t#N/A\n"),
            Outcome::Err(..) => panic!("expected array"),
        }
    }

    #[test]
    fn array_text_separators_are_escaped() {
        match run(&args(&[
            "eval",
            "={\"a\"&CHAR(9)&\"b\",\"c\"&CHAR(10)&\"d\\\"}",
        ])) {
            Outcome::Ok(msg) => assert_eq!(msg, "<array 1x2>\na\\tb\tc\\nd\\\\\n"),
            Outcome::Err(..) => panic!("expected array"),
        }
    }

    #[test]
    fn large_array_result_is_elided() {
        match run(&args(&["eval", "=SEQUENCE(60)"])) {
            Outcome::Ok(msg) => {
                assert_eq!(msg.lines().count(), 52);
                assert!(msg.ends_with("50\n... 10 more rows\n"), "{msg}");
            }
            Outcome::Err(..) => panic!("expected array"),
        }
    }

    #[test]
    fn syntax_error_points_at_position_in_input() {
        match run(&args(&["eval", "==1"])) {
            Outcome::Err(3, msg) => assert_eq!(
                msg,
                "error: unexpected token at byte 1 (character 2)\n  ==1\n   ^\n"
            ),
            _ => panic!("expected syntax error"),
        }
        match run(&args(&["eval", "=\"あ\"+"])) {
            Outcome::Err(3, msg) => assert!(
                msg.ends_with("(character 6)\n  =\"あ\"+\n    \u{3000}  ^\n"),
                "{msg}"
            ),
            _ => panic!("expected syntax error"),
        }
    }

    #[test]
    fn syntax_error_caret_is_on_the_failing_line() {
        match run(&args(&["eval", "=1+\n\t2+"])) {
            Outcome::Err(3, msg) => assert!(msg.ends_with("\n  \t2+\n  \t  ^\n"), "{msg:?}"),
            _ => panic!("expected syntax error"),
        }
    }

    #[test]
    fn unknown_command_errors() {
        match run(&args(&["frob"])) {
            Outcome::Err(2, msg) => assert!(msg.contains("unknown command `frob`")),
            _ => panic!("expected unknown-command error"),
        }
    }
}
