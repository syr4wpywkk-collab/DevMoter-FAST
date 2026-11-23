//! Formula lexer (plan §4.1).
//!
//! Converts formula source text (without the leading `=`) into tokens with
//! byte offsets. Whitespace is skipped — meaning that Excel's
//! space-as-intersection operator is currently *not* supported
//! (SPEC-OPEN); `A1 B2` parses as two adjacent expressions and the parser
//! rejects it rather than intersecting.
//!
//! Supported tokens: numbers, `"strings"` (`""` escape), `'quoted names'`
//! (`''` escape, for sheet qualifiers), error literals (`#N/A` …),
//! words (identifiers / function names / `$`-decorated cell references),
//! operators `+ - * / ^ & % = < > <= >= <>`, `( ) , : !` and the array
//! literal punctuation `{ } ;`.
//!
//! `;` outside an array literal (locale argument separators) is rejected
//! by the parser.
use crate::error::CalcError;

/// A lexical token with its start byte offset in the source.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    /// Byte offset of the first character of this token.
    pub offset: usize,
}

/// Token kinds produced by [`lex`].
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    /// Numeric literal, e.g. `1`, `2.5`, `.5`, `1e-3`.
    Number(f64),
    /// `"..."` literal (`""` unescaped to `"`).
    Str(String),
    /// `'...'` quoted name (only valid before `!`).
    QuotedName(String),
    /// `#N/A`-style literal.
    ErrorLit(CalcError),
    /// Identifier-ish word: letters/digits/`_`/`.`/`$`, e.g. `SUM`,
    /// `A1`, `$B$2`, `my.name`. Classification is the parser's job.
    Word(String),
    LParen,
    RParen,
    Comma,
    Colon,
    Bang,
    /// `{` — array literal open.
    LBrace,
    /// `}` — array literal close.
    RBrace,
    /// `;` — array literal row separator (rejected elsewhere).
    Semi,
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Amp,
    Percent,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    /// End of input.
    Eof,
}

/// Errors during lexing, reported with a byte offset.
#[derive(Debug, Clone, PartialEq)]
pub struct LexError {
    pub kind: LexErrorKind,
    /// Byte offset where the problem was detected.
    pub offset: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LexErrorKind {
    /// Character cannot start any token.
    UnexpectedChar(char),
    /// `"` or `'` without a matching close quote.
    UnterminatedString,
    /// `#...` that doesn't match a known error literal.
    InvalidErrorLiteral,
    /// Number failed to parse or is not finite.
    InvalidNumber,
    /// More tokens than the configured limit.
    TooManyTokens,
}

impl LexError {
    fn new(kind: LexErrorKind, offset: usize) -> LexError {
        LexError { kind, offset }
    }
}

impl std::fmt::Display for LexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match &self.kind {
            LexErrorKind::UnexpectedChar(c) => format!("unexpected character {c:?}"),
            LexErrorKind::UnterminatedString => "unterminated string".to_string(),
            LexErrorKind::InvalidErrorLiteral => "invalid error literal".to_string(),
            LexErrorKind::InvalidNumber => "invalid number".to_string(),
            LexErrorKind::TooManyTokens => "too many tokens".to_string(),
        };
        write!(f, "{msg} at byte {}", self.offset)
    }
}

impl std::error::Error for LexError {}

/// Lex `src` into tokens (a terminating `Eof` token is appended).
///
/// `max_tokens` bounds output size; exceeding it yields
/// [`LexErrorKind::TooManyTokens`].
pub fn lex(src: &str, max_tokens: usize) -> Result<Vec<Token>, LexError> {
    let bytes = src.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;

    macro_rules! push {
        ($kind:expr, $at:expr) => {{
            tokens.push(Token {
                kind: $kind,
                offset: $at,
            });
            if tokens.len() > max_tokens {
                return Err(LexError::new(LexErrorKind::TooManyTokens, $at));
            }
        }};
    }

    while i < bytes.len() {
        let at = i;
        let b = bytes[i];
        match b {
            b' ' | b'\t' | b'\r' | b'\n' => {
                i += 1;
            }
            b'0'..=b'9' => {
                let (n, end) = lex_number(src, i, false)?;
                push!(TokenKind::Number(n), at);
                i = end;
            }
            b'.' if matches!(bytes.get(i + 1), Some(b'0'..=b'9')) => {
                let (n, end) = lex_number(src, i, true)?;
                push!(TokenKind::Number(n), at);
                i = end;
            }
            b'"' => {
                let (s, end) = lex_quoted(src, i, '"')?;
                push!(TokenKind::Str(s), at);
                i = end;
            }
            b'\'' => {
                let (s, end) = lex_quoted(src, i, '\'')?;
                push!(TokenKind::QuotedName(s), at);
                i = end;
            }
            b'#' => {
                let (e, end) = lex_error_literal(src, i)?;
                push!(TokenKind::ErrorLit(e), at);
                i = end;
            }
            b'(' => {
                push!(TokenKind::LParen, at);
                i += 1;
            }
            b')' => {
                push!(TokenKind::RParen, at);
                i += 1;
            }
            b',' => {
                push!(TokenKind::Comma, at);
                i += 1;
            }
            b':' => {
                push!(TokenKind::Colon, at);
                i += 1;
            }
            b'{' => {
                push!(TokenKind::LBrace, at);
                i += 1;
            }
            b'}' => {
                push!(TokenKind::RBrace, at);
                i += 1;
            }
            b';' => {
                push!(TokenKind::Semi, at);
                i += 1;
            }
            b'!' => {
                push!(TokenKind::Bang, at);
                i += 1;
            }
            b'+' => {
                push!(TokenKind::Plus, at);
                i += 1;
            }
            b'-' => {
                push!(TokenKind::Minus, at);
                i += 1;
            }
            b'*' => {
                push!(TokenKind::Star, at);
                i += 1;
            }
            b'/' => {
                push!(TokenKind::Slash, at);
                i += 1;
            }
            b'^' => {
                push!(TokenKind::Caret, at);
                i += 1;
            }
            b'&' => {
                push!(TokenKind::Amp, at);
                i += 1;
            }
            b'%' => {
                push!(TokenKind::Percent, at);
                i += 1;
            }
            b'=' => {
                push!(TokenKind::Eq, at);
                i += 1;
            }
            b'<' => {
                let kind = match bytes.get(i + 1) {
                    Some(b'=') => {
                        i += 1;
                        TokenKind::Le
                    }
                    Some(b'>') => {
                        i += 1;
                        TokenKind::Ne
                    }
                    _ => TokenKind::Lt,
                };
                push!(kind, at);
                i += 1;
            }
            b'>' => {
                let kind = if bytes.get(i + 1) == Some(&b'=') {
                    i += 1;
                    TokenKind::Ge
                } else {
                    TokenKind::Gt
                };
                push!(kind, at);
                i += 1;
            }
            _ if is_word_start(b) => {
                let end = lex_word(bytes, i);
                push!(TokenKind::Word(src[at..end].to_string()), at);
                i = end;
            }
            _ => {
                return Err(LexError::new(LexErrorKind::UnexpectedChar(b as char), at));
            }
        }
    }

    push!(TokenKind::Eof, i);
    Ok(tokens)
}

/// `is_word_start` covers ASCII letters, `_`, `$`, and any non-ASCII char
/// (a conservative superset — validation happens in the parser).
fn is_word_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_' || b == b'$' || !b.is_ascii()
}

fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'$' || !b.is_ascii()
}

fn lex_word(bytes: &[u8], start: usize) -> usize {
    let mut i = start;
    while i < bytes.len() && is_word_char(bytes[i]) {
        i += 1;
    }
    i
}

/// Lex `[digits][.digits][e[+-]digits]` or `.digits[e[+-]digits]`.
/// Returns the value and end offset.
fn lex_number(src: &str, start: usize, starts_with_dot: bool) -> Result<(f64, usize), LexError> {
    let bytes = src.as_bytes();
    let mut i = start;
    if starts_with_dot {
        i += 1; // consume '.'
    }
    while matches!(bytes.get(i), Some(b'0'..=b'9')) {
        i += 1;
    }
    if !starts_with_dot && bytes.get(i) == Some(&b'.') {
        // consume '.' and following digits (allow "1.")
        i += 1;
        while matches!(bytes.get(i), Some(b'0'..=b'9')) {
            i += 1;
        }
    }
    // exponent
    if matches!(bytes.get(i), Some(b'e') | Some(b'E')) {
        let exp_at = i;
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+') | Some(b'-')) {
            j += 1;
        }
        if matches!(bytes.get(j), Some(b'0'..=b'9')) {
            while matches!(bytes.get(j), Some(b'0'..=b'9')) {
                j += 1;
            }
            i = j;
        } else {
            // "1e" with no digits — treat 'e' as not part of the number;
            // it will lex as a Word start and the parser will error.
            i = exp_at;
        }
    }
    let text = &src[start..i];
    let n: f64 = text
        .parse()
        .map_err(|_| LexError::new(LexErrorKind::InvalidNumber, start))?;
    if !n.is_finite() {
        return Err(LexError::new(LexErrorKind::InvalidNumber, start));
    }
    Ok((n, i))
}

/// Lex a `'` or `"` quoted string starting at `start`. Doubling the quote
/// char is the escape (`""`, `''`). Returns unescaped content + end offset.
fn lex_quoted(src: &str, start: usize, quote: char) -> Result<(String, usize), LexError> {
    let q = quote as u8;
    let bytes = src.as_bytes();
    let mut out = String::new();
    let mut i = start + 1;
    loop {
        match bytes.get(i) {
            None => return Err(LexError::new(LexErrorKind::UnterminatedString, start)),
            Some(&b) if b == q => {
                if bytes.get(i + 1) == Some(&q) {
                    out.push(quote);
                    i += 2;
                } else {
                    return Ok((out, i + 1));
                }
            }
            Some(_) => {
                // safe to index by byte: we only skip full UTF-8 chars
                let ch_len = src[i..].chars().next().unwrap().len_utf8();
                out.push_str(&src[i..i + ch_len]);
                i += ch_len;
            }
        }
    }
}

/// Lex `#...` error literals. Consumes the longest run of characters that
/// can appear in an error literal, then matches it against [`CalcError`].
fn lex_error_literal(src: &str, start: usize) -> Result<(CalcError, usize), LexError> {
    let bytes = src.as_bytes();
    let mut i = start + 1;
    // Error literals contain letters, digits, '/', '!', '?', '.'.
    while let Some(&b) = bytes.get(i) {
        if b.is_ascii_alphanumeric() || b == b'/' || b == b'!' || b == b'?' || b == b'.' {
            i += 1;
        } else {
            break;
        }
    }
    let text = &src[start..i];
    // `#N/A` must not greedily swallow e.g. `#N/A/B` — try progressively
    // shorter prefixes so trailing operator chars still lex correctly.
    // (Known literals are the only valid prefixes anyway.)
    let mut end = text.len();
    while end > 1 {
        if let Some(e) = CalcError::from_code(&text[..end]) {
            return Ok((e, start + end));
        }
        // back off one char at a time (ASCII-safe boundaries)
        end -= 1;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
    }
    Err(LexError::new(LexErrorKind::InvalidErrorLiteral, start))
}
