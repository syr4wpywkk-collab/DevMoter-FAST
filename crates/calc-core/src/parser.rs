//! Formula parser (plan §4.2): recursive descent with Excel's precedence.
//!
//! Precedence, loosest to tightest:
//!
//! 1. comparisons `= <> < <= > >=`   (left-assoc)
//! 2. `&` concatenation            (left-assoc)
//! 3. `+ -`                        (left-assoc)
//! 4. `* /`                        (left-assoc)
//! 5. `^`                          (left-assoc — Excel evaluates `2^3^2` as 64)
//! 6. unary `+ -`                  (tighter than `^`: Excel `-2^2` = 4)
//! 7. postfix `%`
//! 8. primaries: literals, refs, ranges, calls, parenthesized exprs
//!
//! Reference `:` binds at the primary level (`Sheet1!A1:B2`).
//!
//! Safety limits are module constants; exceeding any is a structured error.

use crate::ast::{BinaryOp, Expr, Literal, UnaryOp};
use crate::cell::{CellRef, RangeRef, is_valid_unquoted_sheet_name};
use crate::lexer::{LexError, LexErrorKind, Token, TokenKind, lex};

/// Maximum formula length in bytes (plan §10.4: 式長64 KiB).
pub const MAX_FORMULA_LEN: usize = 64 * 1024;
/// Maximum lexer tokens per formula. Deliberately larger than
/// [`MAX_AST_NODES`]: each AST node needs at least one token, so a lower
/// token limit would make the node limit unreachable.
pub const MAX_TOKENS: usize = 20_000;
/// Maximum AST nodes per formula (plan §10.4: 構文木ノード10,000).
pub const MAX_AST_NODES: usize = 10_000;
/// Maximum recursion/nesting depth (plan §10.4: 再帰深度256).
pub const MAX_DEPTH: usize = 256;

/// A parse failure with a byte offset into the formula text.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub kind: ParseErrorKind,
    /// Byte offset where the problem was detected.
    pub offset: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParseErrorKind {
    /// Input is empty or whitespace-only.
    EmptyFormula,
    /// Longer than [`MAX_FORMULA_LEN`].
    FormulaTooLong,
    /// Lexer-level failure (bad char, unterminated string, ...).
    Lex(LexErrorKind),
    /// Token where an expression was expected.
    UnexpectedToken,
    /// Input ended mid-expression.
    UnexpectedEof,
    /// A specific token/syntax element was expected.
    Expected(&'static str),
    /// A word was not a valid cell reference.
    InvalidReference,
    /// A quoted name was not followed by `!`.
    OrphanQuotedName,
    /// A name is not a valid function name.
    InvalidFunctionName,
    /// More AST nodes than [`MAX_AST_NODES`].
    TooManyNodes,
    /// Deeper nesting than [`MAX_DEPTH`].
    TooDeep,
}

impl ParseError {
    fn new(kind: ParseErrorKind, offset: usize) -> ParseError {
        ParseError { kind, offset }
    }
}

impl From<LexError> for ParseError {
    fn from(e: LexError) -> ParseError {
        ParseError {
            kind: ParseErrorKind::Lex(e.kind),
            offset: e.offset,
        }
    }
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match &self.kind {
            ParseErrorKind::EmptyFormula => "empty formula".to_string(),
            ParseErrorKind::FormulaTooLong => "formula too long".to_string(),
            ParseErrorKind::Lex(k) => return write!(f, "lex error at byte {}: {k:?}", self.offset),
            ParseErrorKind::UnexpectedToken => "unexpected token".to_string(),
            ParseErrorKind::UnexpectedEof => "unexpected end of formula".to_string(),
            ParseErrorKind::Expected(what) => format!("expected {what}"),
            ParseErrorKind::InvalidReference => "invalid cell reference".to_string(),
            ParseErrorKind::OrphanQuotedName => "quoted name must be followed by '!'".to_string(),
            ParseErrorKind::InvalidFunctionName => "invalid function name".to_string(),
            ParseErrorKind::TooManyNodes => "too many AST nodes".to_string(),
            ParseErrorKind::TooDeep => "nesting too deep".to_string(),
        };
        write!(f, "{msg} at byte {}", self.offset)
    }
}

impl std::error::Error for ParseError {}

/// Parse formula source text (without a leading `=`) into an [`Expr`].
///
/// A single leading `=` is stripped for convenience. Enforces
/// [`MAX_FORMULA_LEN`], [`MAX_TOKENS`], [`MAX_AST_NODES`] and [`MAX_DEPTH`].
pub fn parse(src: &str) -> Result<Expr, ParseError> {
    let src = src.strip_prefix('=').unwrap_or(src);
    if src.trim().is_empty() {
        return Err(ParseError::new(ParseErrorKind::EmptyFormula, 0));
    }
    if src.len() > MAX_FORMULA_LEN {
        return Err(ParseError::new(ParseErrorKind::FormulaTooLong, 0));
    }
    let tokens = lex(src, MAX_TOKENS)?;
    let mut p = Parser {
        tokens: &tokens,
        pos: 0,
        depth: 0,
        nodes: 0,
    };
    let expr = p.parse_comparison()?;
    let t = p.peek();
    if t.kind != TokenKind::Eof {
        return Err(ParseError::new(ParseErrorKind::UnexpectedToken, t.offset));
    }
    Ok(expr)
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
    depth: usize,
    nodes: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> &'a Token {
        &self.tokens[self.pos.min(self.tokens.len() - 1)]
    }

    fn bump(&mut self) -> &'a Token {
        let t = &self.tokens[self.pos.min(self.tokens.len() - 1)];
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        t
    }

    fn at(&self, kind: &TokenKind) -> bool {
        &self.peek().kind == kind
    }

    fn enter(&mut self) -> Result<(), ParseError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            self.depth -= 1;
            return Err(ParseError::new(ParseErrorKind::TooDeep, self.peek().offset));
        }
        Ok(())
    }

    fn leave(&mut self) {
        self.depth -= 1;
    }

    fn make(&mut self, expr: Expr) -> Result<Expr, ParseError> {
        self.nodes += 1;
        if self.nodes > MAX_AST_NODES {
            return Err(ParseError::new(
                ParseErrorKind::TooManyNodes,
                self.peek().offset,
            ));
        }
        Ok(expr)
    }

    // comparison := concat (compOp concat)*
    fn parse_comparison(&mut self) -> Result<Expr, ParseError> {
        self.enter()?;
        let r = (|| {
            let mut left = self.parse_concat()?;
            loop {
                let op = match self.peek().kind {
                    TokenKind::Eq => BinaryOp::Eq,
                    TokenKind::Ne => BinaryOp::Ne,
                    TokenKind::Lt => BinaryOp::Lt,
                    TokenKind::Le => BinaryOp::Le,
                    TokenKind::Gt => BinaryOp::Gt,
                    TokenKind::Ge => BinaryOp::Ge,
                    _ => break,
                };
                self.bump();
                let right = self.parse_concat()?;
                left = self.make(Expr::Binary {
                    op,
                    left: Box::new(left),
                    right: Box::new(right),
                })?;
            }
            Ok(left)
        })();
        self.leave();
        r
    }

    // concat := additive ('&' additive)*
    fn parse_concat(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_additive()?;
        while self.at(&TokenKind::Amp) {
            self.bump();
            let right = self.parse_additive()?;
            left = self.make(Expr::Binary {
                op: BinaryOp::Concat,
                left: Box::new(left),
                right: Box::new(right),
            })?;
        }
        Ok(left)
    }

    // additive := multiplicative (('+'|'-') multiplicative)*
    fn parse_additive(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let op = match self.peek().kind {
                TokenKind::Plus => BinaryOp::Add,
                TokenKind::Minus => BinaryOp::Sub,
                _ => break,
            };
            self.bump();
            let right = self.parse_multiplicative()?;
            left = self.make(Expr::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            })?;
        }
        Ok(left)
    }

    // multiplicative := power (('*'|'/') power)*
    fn parse_multiplicative(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_power()?;
        loop {
            let op = match self.peek().kind {
                TokenKind::Star => BinaryOp::Mul,
                TokenKind::Slash => BinaryOp::Div,
                _ => break,
            };
            self.bump();
            let right = self.parse_power()?;
            left = self.make(Expr::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            })?;
        }
        Ok(left)
    }

    // power := unary ('^' unary)*   — left-associative, as in Excel
    fn parse_power(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_unary()?;
        while self.at(&TokenKind::Caret) {
            self.bump();
            let right = self.parse_unary()?;
            left = self.make(Expr::Binary {
                op: BinaryOp::Pow,
                left: Box::new(left),
                right: Box::new(right),
            })?;
        }
        Ok(left)
    }

    // unary := ('-'|'+') unary | postfix
    fn parse_unary(&mut self) -> Result<Expr, ParseError> {
        self.enter()?;
        let r = (|| {
            let op = match self.peek().kind {
                TokenKind::Minus => Some(UnaryOp::Neg),
                TokenKind::Plus => Some(UnaryOp::Pos),
                _ => None,
            };
            if let Some(op) = op {
                self.bump();
                let operand = self.parse_unary()?;
                return self.make(Expr::Unary {
                    op,
                    operand: Box::new(operand),
                });
            }
            self.parse_postfix()
        })();
        self.leave();
        r
    }

    // postfix := primary '%'*
    fn parse_postfix(&mut self) -> Result<Expr, ParseError> {
        let mut e = self.parse_primary()?;
        while self.at(&TokenKind::Percent) {
            self.bump();
            e = self.make(Expr::Percent(Box::new(e)))?;
        }
        Ok(e)
    }

    fn parse_primary(&mut self) -> Result<Expr, ParseError> {
        self.enter()?;
        let r = self.parse_primary_inner();
        self.leave();
        r
    }

    fn parse_primary_inner(&mut self) -> Result<Expr, ParseError> {
        let t = self.bump();
        let offset = t.offset;
        match &t.kind {
            TokenKind::Number(n) => self.make(Expr::Literal(Literal::Number(*n))),
            TokenKind::Str(s) => self.make(Expr::Literal(Literal::Text(s.clone()))),
            TokenKind::ErrorLit(e) => self.make(Expr::Literal(Literal::Error(*e))),
            TokenKind::LParen => {
                let inner = self.parse_comparison()?;
                let close = self.bump();
                if close.kind != TokenKind::RParen {
                    return Err(ParseError::new(
                        if close.kind == TokenKind::Eof {
                            ParseErrorKind::UnexpectedEof
                        } else {
                            ParseErrorKind::Expected("')'")
                        },
                        close.offset,
                    ));
                }
                // A parenthesized expression: no extra node kind needed.
                Ok(inner)
            }
            TokenKind::QuotedName(name) => {
                let name = name.clone();
                if !self.at(&TokenKind::Bang) {
                    return Err(ParseError::new(ParseErrorKind::OrphanQuotedName, offset));
                }
                self.bump(); // '!'
                self.parse_ref_after_sheet(Some(name), offset)
            }
            TokenKind::Word(w) => {
                let w = w.clone();
                match self.peek().kind {
                    TokenKind::LParen => self.parse_call(&w, offset),
                    TokenKind::Bang => {
                        if !is_valid_unquoted_sheet_name(&w) {
                            return Err(ParseError::new(ParseErrorKind::InvalidReference, offset));
                        }
                        self.bump();
                        self.parse_ref_after_sheet(Some(w), offset)
                    }
                    _ => {
                        let mut e = self.classify_word(&w, offset, None)?;
                        // range: <cellref> ':' <cellref>
                        if self.at(&TokenKind::Colon) {
                            if matches!(e, Expr::CellRef { .. }) {
                                e = self.parse_range_tail(e, None)?;
                            } else {
                                let t = self.peek();
                                return Err(ParseError::new(
                                    ParseErrorKind::UnexpectedToken,
                                    t.offset,
                                ));
                            }
                        }
                        Ok(e)
                    }
                }
            }
            _ => Err(ParseError::new(
                if t.kind == TokenKind::Eof {
                    ParseErrorKind::UnexpectedEof
                } else {
                    ParseErrorKind::UnexpectedToken
                },
                offset,
            )),
        }
    }

    /// After `name!`, parse a cell ref or range on that sheet.
    fn parse_ref_after_sheet(
        &mut self,
        sheet: Option<String>,
        _offset: usize,
    ) -> Result<Expr, ParseError> {
        let t = self.bump();
        let (e, is_cell) = match &t.kind {
            TokenKind::Word(w) => match parse_cellref(w) {
                Some(cell) => (
                    self.make(Expr::CellRef {
                        sheet: sheet.clone(),
                        cell,
                    })?,
                    true,
                ),
                None => {
                    return Err(ParseError::new(ParseErrorKind::InvalidReference, t.offset));
                }
            },
            _ => {
                return Err(ParseError::new(
                    ParseErrorKind::Expected("cell reference after '!'"),
                    t.offset,
                ));
            }
        };
        if is_cell && self.at(&TokenKind::Colon) {
            return self.parse_range_tail(e, sheet);
        }
        Ok(e)
    }

    /// `e` is a `CellRef` node just parsed and `:` follows; parse the range
    /// endpoint and produce a `RangeRef` node. `sheet` is the qualifier
    /// carried over from `name!A1` when present.
    fn parse_range_tail(&mut self, e: Expr, sheet: Option<String>) -> Result<Expr, ParseError> {
        self.bump(); // ':'
        let t = self.bump();
        let end = match &t.kind {
            TokenKind::Word(w) => parse_cellref(w)
                .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidReference, t.offset))?,
            _ => {
                return Err(ParseError::new(
                    ParseErrorKind::Expected("cell reference after ':'"),
                    t.offset,
                ));
            }
        };
        let start = match e {
            Expr::CellRef { cell, .. } => cell,
            _ => unreachable!("range tail called on non-cell"),
        };
        self.make(Expr::RangeRef {
            sheet,
            range: RangeRef { start, end },
        })
    }

    /// A bare word with no `(`/`!`: TRUE/FALSE literal, cell reference, or
    /// defined name.
    fn classify_word(
        &mut self,
        w: &str,
        _offset: usize,
        sheet: Option<String>,
    ) -> Result<Expr, ParseError> {
        debug_assert!(sheet.is_none());
        if let Some(cell) = parse_cellref(w) {
            return self.make(Expr::CellRef { sheet: None, cell });
        }
        match w.to_ascii_uppercase().as_str() {
            "TRUE" => return self.make(Expr::Literal(Literal::Bool(true))),
            "FALSE" => return self.make(Expr::Literal(Literal::Bool(false))),
            _ => {}
        }
        self.make(Expr::Name(w.to_string()))
    }

    /// `name(` — parse the argument list.
    fn parse_call(&mut self, name: &str, offset: usize) -> Result<Expr, ParseError> {
        if !is_valid_fn_name(name) {
            return Err(ParseError::new(ParseErrorKind::InvalidFunctionName, offset));
        }
        self.bump(); // '('
        self.enter()?;
        let r = (|| {
            let mut args = Vec::new();
            if self.at(&TokenKind::RParen) {
                self.bump();
                return self.make(Expr::Call {
                    name: name.to_string(),
                    args,
                });
            }
            loop {
                // Omitted argument: `F(,x)` / `F(x,)`.
                if self.at(&TokenKind::Comma) || self.at(&TokenKind::RParen) {
                    args.push(self.make(Expr::Missing)?);
                } else {
                    args.push(self.parse_comparison()?);
                }
                match self.peek().kind {
                    TokenKind::Comma => {
                        self.bump();
                    }
                    TokenKind::RParen => {
                        self.bump();
                        break;
                    }
                    TokenKind::Eof => {
                        return Err(ParseError::new(
                            ParseErrorKind::UnexpectedEof,
                            self.peek().offset,
                        ));
                    }
                    _ => {
                        let t = self.peek();
                        return Err(ParseError::new(
                            ParseErrorKind::Expected("',' or ')'"),
                            t.offset,
                        ));
                    }
                }
            }
            self.make(Expr::Call {
                name: name.to_string(),
                args,
            })
        })();
        self.leave();
        r
    }
}

/// Does `w` lexically match a cell reference (incl. `$` forms, bounds)?
fn parse_cellref(w: &str) -> Option<CellRef> {
    CellRef::from_a1(w).ok()
}

/// Function names: start with a letter/`_`, then letters/digits/`.`/`_`.
/// (Excel also allows non-ASCII letters; `char::is_alphabetic` covers that.)
/// Does not overlap with cell refs since callers check `(` first.
fn is_valid_fn_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_alphabetic() || c == '_' => {}
        _ => return false,
    }
    name.chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
        && !name.contains('$')
}
