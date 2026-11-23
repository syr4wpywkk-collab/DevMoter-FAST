//! calc-core: spreadsheet formula parsing, dependency tracking and evaluation.
//!
//! Scope is the 38-function subset declared in `docs/IMPLEMENTATION_PLAN.md`.
//! Full Excel compatibility is an explicit non-goal; the declared subset is
//! specified, tested against reference implementations, and errors are
//! reported explicitly instead of being silently coerced.

pub mod array;
pub mod ast;
pub mod cell;
pub mod error;
pub mod lexer;
pub mod parser;
pub mod value;
pub mod workbook;

pub use array::ArrayValue;
pub use ast::{BinaryOp, Expr, Literal, UnaryOp};
pub use cell::{
    CellId, CellRef, MAX_COLS, MAX_ROWS, RangeRef, RefParseError, RefParseErrorKind, RefTarget,
    SheetQualifiedRef,
};
pub use error::CalcError;
pub use lexer::{LexError, LexErrorKind, Token, TokenKind, lex};
pub use parser::{
    MAX_AST_NODES, MAX_DEPTH, MAX_FORMULA_LEN, MAX_TOKENS, ParseError, ParseErrorKind, parse,
};
pub use value::{Value, ValueKind};
pub use workbook::{Cell, CellInput, DateSystem, Sheet, Workbook, WorkbookError};

pub fn engine_name() -> &'static str {
    "calc-core"
}
