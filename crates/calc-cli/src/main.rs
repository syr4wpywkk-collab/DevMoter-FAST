//! calc-cli: development CLI for evaluating formulas.
//!
//! Only the `eval` subcommand's argument surface exists so far; the parser and
//! evaluator in calc-core are not implemented yet, so `eval` reports that
//! explicitly instead of pretending to compute something.

use std::process::ExitCode;

const USAGE: &str = "\
calc-cli — development CLI for the calc engine

USAGE:
    calc-cli <COMMAND>

COMMANDS:
    eval <FORMULA>   Evaluate a formula string (not yet implemented)
    help             Print this message
";

/// Outcome of parsing and dispatching a command line.
enum Outcome {
    /// Print to stdout, exit 0.
    Ok(String),
    /// Print to stderr, exit with the given code.
    Err(u8, String),
}

fn run(args: &[String]) -> Outcome {
    match args.first().map(String::as_str) {
        None | Some("help") | Some("--help") | Some("-h") => Outcome::Ok(USAGE.to_string()),
        Some("eval") => match args.get(1) {
            None => Outcome::Err(
                2,
                "error: `eval` requires a <FORMULA> argument\n".to_string(),
            ),
            Some(_formula) => Outcome::Err(
                3,
                format!(
                    "error: `{}` formula evaluation is not implemented yet \
                     (parser/evaluator land in PR-02/PR-03)\n",
                    calc_core::engine_name()
                ),
            ),
        },
        Some(other) => Outcome::Err(2, format!("error: unknown command `{other}`\n\n{USAGE}")),
    }
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
    fn eval_reports_not_implemented() {
        match run(&args(&["eval", "=1+1"])) {
            Outcome::Err(3, msg) => assert!(msg.contains("not implemented")),
            _ => panic!("expected not-implemented error"),
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
