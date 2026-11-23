//! Abstract syntax tree for parsed formulas (plan §4.3).
//!
//! Sheet-qualified references carry the (unescaped) sheet name on the
//! node; resolution to a `sheet_id` happens during evaluation.
use crate::cell::{CellRef, RangeRef};
use crate::error::CalcError;

/// Literal values that can appear verbatim in a formula.
#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    Number(f64),
    Text(String),
    Bool(bool),
    Error(CalcError),
}

/// Unary (prefix) operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    /// `-x`
    Neg,
    /// `+x` (no-op in Excel, but preserved for faithful AST round-tripping)
    Pos,
}

/// Binary operators, in Excel precedence order (highest first): `^`, `* /`,
/// `+ -`, `&`, then comparisons.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    // arithmetic
    Pow,
    Mul,
    Div,
    Add,
    Sub,
    /// `&` string concatenation
    Concat,
    // comparisons (result: Boolean or Error)
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

/// A formula AST node.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// Constant literal: `1`, `2.5`, `"text"`, `TRUE`, `#N/A`.
    Literal(Literal),
    /// An empty/omitted argument: `IF(A1,,3)` — the middle slot.
    /// Excel assigns each function its own default for omitted args.
    Missing,
    /// Bare defined name / unrecognized identifier: `my_name`, `foo`.
    /// Resolution (defined names, `#NAME?`) is an evaluator concern.
    Name(String),
    /// Prefix unary: `-A1`, `+B2`.
    Unary { op: UnaryOp, operand: Box<Expr> },
    /// Postfix percent: `50%` evaluates to `0.5`.
    Percent(Box<Expr>),
    /// Infix binary operation.
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    /// Function call: `SUM(A1:A3, 5)`.
    Call { name: String, args: Vec<Expr> },
    /// Invocation of an arbitrary expression producing a lambda:
    /// `LAMBDA(x,x+1)(5)` or `LET(f,LAMBDA(x,x),(f)(3))`. Named calls stay
    /// [`Expr::Call`]; this node covers non-name callees.
    Invoke { callee: Box<Expr>, args: Vec<Expr> },
    /// Array literal `{1,2;3,4}`: rows of expressions (`,` between
    /// columns, `;` between rows). Excel restricts elements to constants;
    /// this engine accepts full expressions (SPEC-OPEN parity item).
    ArrayLiteral(Vec<Vec<Expr>>),
    /// Cell reference on the current or a named sheet.
    CellRef {
        sheet: Option<String>,
        cell: CellRef,
    },
    /// Range reference on the current or a named sheet.
    RangeRef {
        sheet: Option<String>,
        range: RangeRef,
    },
    /// Array literal `{1,2;3,4}`: `,` separates columns, `;` rows.
    /// Rectangularity is enforced by the parser.
    ArrayLiteral(Vec<Vec<Expr>>),
}

impl Expr {
    /// Number of nodes in this tree (the node itself counts once).
    pub fn node_count(&self) -> usize {
        match self {
            Expr::Literal(_) | Expr::Missing | Expr::Name(_) | Expr::CellRef { .. } => 1,
            Expr::Unary { operand, .. } | Expr::Percent(operand) => 1 + operand.node_count(),
            Expr::Binary { left, right, .. } => 1 + left.node_count() + right.node_count(),
            Expr::RangeRef { .. } => 1,
            Expr::ArrayLiteral(rows) => {
                1 + rows
                    .iter()
                    .flat_map(|r| r.iter())
                    .map(Expr::node_count)
                    .sum::<usize>()
            }
            Expr::Call { args, .. } => 1 + args.iter().map(Expr::node_count).sum::<usize>(),
            Expr::Invoke { callee, args } => {
                1 + callee.node_count() + args.iter().map(Expr::node_count).sum::<usize>()
            }
            Expr::ArrayLiteral(rows) => {
                1 + rows
                    .iter()
                    .flat_map(|r| r.iter())
                    .map(Expr::node_count)
                    .sum::<usize>()
            }
        }
    }
}
