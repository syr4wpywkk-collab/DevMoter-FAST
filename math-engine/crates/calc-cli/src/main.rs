//! calc-cli: development CLI for evaluating formulas.
//!
//! Composes `calc-core` (engine) with `calc-functions` (standard
//! registry) — the composition root for the library crates (v2 §3).

use std::process::ExitCode;

use calc_core::{CalcEngine, Value};

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
                Err(e) => Outcome::Err(3, format!("error: {e}\n")),
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
            .map(|c| a.get(r, c).map(Value::to_string).unwrap_or_default())
            .collect();
        out.push_str(&row.join("\t"));
        out.push('\n');
    }
    if a.rows() > MAX_ARRAY_ROWS {
        out.push_str(&format!("... {} more rows\n", a.rows() - MAX_ARRAY_ROWS));
    }
    out
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
    fn unknown_command_errors() {
        match run(&args(&["frob"])) {
            Outcome::Err(2, msg) => assert!(msg.contains("unknown command `frob`")),
            _ => panic!("expected unknown-command error"),
        }
    }
}
