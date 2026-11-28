//! Tests for the formula lexer and parser (plan §4): precedence,
//! references, invalid input, and resource limits.

use calc_core::CalcError;
use calc_core::ast::{BinaryOp, Expr, Literal, UnaryOp};
use calc_core::cell::CellRef;
use calc_core::lexer::{LexErrorKind, TokenKind, lex};
use calc_core::parser::{
    MAX_AST_NODES, MAX_DEPTH, MAX_FORMULA_LEN, MAX_TOKENS, ParseErrorKind, parse,
};

// ---------- helpers ----------

fn num(n: f64) -> Expr {
    Expr::Literal(Literal::Number(n))
}

fn text(s: &str) -> Expr {
    Expr::Literal(Literal::Text(s.to_string()))
}

fn cell(col: u32, row: u32) -> Expr {
    Expr::CellRef {
        sheet: None,
        cell: CellRef {
            row,
            col,
            row_abs: false,
            col_abs: false,
        },
    }
}

fn bin(op: BinaryOp, l: Expr, r: Expr) -> Expr {
    Expr::Binary {
        op,
        left: Box::new(l),
        right: Box::new(r),
    }
}

fn neg(e: Expr) -> Expr {
    Expr::Unary {
        op: UnaryOp::Neg,
        operand: Box::new(e),
    }
}

fn call(name: &str, args: Vec<Expr>) -> Expr {
    Expr::Call {
        name: name.to_string(),
        args,
    }
}

fn kinds(src: &str) -> Vec<TokenKind> {
    lex(src, MAX_TOKENS)
        .unwrap()
        .into_iter()
        .map(|t| t.kind)
        .collect()
}

// ---------- lexer ----------

#[test]
fn lex_numbers() {
    assert_eq!(kinds("1")[0], TokenKind::Number(1.0));
    assert_eq!(kinds("2.5")[0], TokenKind::Number(2.5));
    assert_eq!(kinds(".5")[0], TokenKind::Number(0.5));
    assert_eq!(kinds("1.")[0], TokenKind::Number(1.0));
    assert_eq!(kinds("1e3")[0], TokenKind::Number(1000.0));
    assert_eq!(kinds("1E-2")[0], TokenKind::Number(0.01));
    assert_eq!(kinds("2.5e+2")[0], TokenKind::Number(250.0));
}

#[test]
fn lex_string_with_escapes() {
    assert_eq!(
        kinds("\"he said \"\"hi\"\"\"")[0],
        TokenKind::Str("he said \"hi\"".into())
    );
    assert_eq!(kinds("\"'\"")[0], TokenKind::Str("'".into()));
    assert_eq!(kinds("\"\"")[0], TokenKind::Str("".into()));
}

#[test]
fn lex_quoted_name() {
    assert_eq!(
        kinds("'Sales 2026'")[0],
        TokenKind::QuotedName("Sales 2026".into())
    );
    assert_eq!(
        kinds("'O''Brien'")[0],
        TokenKind::QuotedName("O'Brien".into())
    );
}

#[test]
fn lex_operators_and_punctuation() {
    let ks = kinds("< <= <> > >= = + - * / ^ & % ( ) , : !");
    assert_eq!(
        ks[..ks.len() - 1],
        [
            TokenKind::Lt,
            TokenKind::Le,
            TokenKind::Ne,
            TokenKind::Gt,
            TokenKind::Ge,
            TokenKind::Eq,
            TokenKind::Plus,
            TokenKind::Minus,
            TokenKind::Star,
            TokenKind::Slash,
            TokenKind::Caret,
            TokenKind::Amp,
            TokenKind::Percent,
            TokenKind::LParen,
            TokenKind::RParen,
            TokenKind::Comma,
            TokenKind::Colon,
            TokenKind::Bang,
        ]
    );
    assert_eq!(*ks.last().unwrap(), TokenKind::Eof);
}

#[test]
fn lex_error_literals() {
    for (src, e) in [
        ("#DIV/0!", CalcError::DivZero),
        ("#VALUE!", CalcError::Value),
        ("#REF!", CalcError::Ref),
        ("#NAME?", CalcError::Name),
        ("#NUM!", CalcError::Num),
        ("#N/A", CalcError::NA),
        ("#NULL!", CalcError::Null),
        ("#SPILL!", CalcError::Spill),
        ("#CALC!", CalcError::Calc),
    ] {
        assert_eq!(kinds(src)[0], TokenKind::ErrorLit(e), "input {src}");
    }
}

#[test]
fn lex_error_literal_followed_by_operator() {
    // "#N/A+1" must not swallow the '+'.
    let ks = kinds("#N/A+1");
    assert_eq!(ks[0], TokenKind::ErrorLit(CalcError::NA));
    assert_eq!(ks[1], TokenKind::Plus);
}

#[test]
fn lex_word_forms() {
    assert_eq!(kinds("SUM")[0], TokenKind::Word("SUM".into()));
    assert_eq!(kinds("$A$1")[0], TokenKind::Word("$A$1".into()));
    assert_eq!(kinds("STDEV.S")[0], TokenKind::Word("STDEV.S".into()));
    assert_eq!(kinds("my_name")[0], TokenKind::Word("my_name".into()));
}

#[test]
fn lex_offsets() {
    let toks = lex("1 +22", MAX_TOKENS).unwrap();
    assert_eq!(toks[0].offset, 0);
    assert_eq!(toks[1].offset, 2);
    assert_eq!(toks[2].offset, 3);
}

#[test]
fn lex_rejects_bad_input() {
    // `{`/`}`/`;` lex as array-literal tokens now (the parser rejects
    // them outside literals); other stray characters still fail.
    assert_eq!(
        lex("@", MAX_TOKENS).unwrap_err().kind,
        LexErrorKind::UnexpectedChar('@')
    );
    assert_eq!(
        lex("?", MAX_TOKENS).unwrap_err().kind,
        LexErrorKind::UnexpectedChar('?')
    );
    assert_eq!(
        lex("\"abc", MAX_TOKENS).unwrap_err().kind,
        LexErrorKind::UnterminatedString
    );
    assert_eq!(
        lex("'abc", MAX_TOKENS).unwrap_err().kind,
        LexErrorKind::UnterminatedString
    );
    assert_eq!(
        lex("#BOOM!", MAX_TOKENS).unwrap_err().kind,
        LexErrorKind::InvalidErrorLiteral
    );
    assert_eq!(
        lex("1e999", MAX_TOKENS).unwrap_err().kind,
        LexErrorKind::InvalidNumber
    );
    // `=` is a valid token (comparison); parse() only strips one leading '='
    assert_eq!(err_kind("==1"), ParseErrorKind::UnexpectedToken);
}

#[test]
fn lex_token_limit() {
    let err = lex("1+1+1", 3).unwrap_err();
    assert_eq!(err.kind, LexErrorKind::TooManyTokens);
}

// ---------- literals & primaries ----------

#[test]
fn parse_number_literal() {
    assert_eq!(parse("42").unwrap(), num(42.0));
    assert_eq!(parse("=2.5").unwrap(), num(2.5)); // '=' tolerated
}

#[test]
fn parse_string_literal() {
    assert_eq!(parse("\"hi\"").unwrap(), text("hi"));
    assert_eq!(parse("\"\"").unwrap(), text(""));
}

#[test]
fn parse_bool_literals() {
    assert_eq!(parse("TRUE").unwrap(), Expr::Literal(Literal::Bool(true)));
    assert_eq!(parse("false").unwrap(), Expr::Literal(Literal::Bool(false)));
}

#[test]
fn parse_error_literal() {
    assert_eq!(
        parse("#N/A").unwrap(),
        Expr::Literal(Literal::Error(CalcError::NA))
    );
    assert_eq!(
        parse("#DIV/0!").unwrap(),
        Expr::Literal(Literal::Error(CalcError::DivZero))
    );
}

#[test]
fn parse_parens() {
    assert_eq!(parse("(1)").unwrap(), num(1.0));
    assert_eq!(parse("((2))").unwrap(), num(2.0));
    assert_eq!(
        parse("(1+2)").unwrap(),
        bin(BinaryOp::Add, num(1.0), num(2.0))
    );
}

#[test]
fn parse_name() {
    assert_eq!(parse("my_name").unwrap(), Expr::Name("my_name".into()));
    assert_eq!(parse("FOO").unwrap(), Expr::Name("FOO".into()));
}

#[test]
fn log10_without_parens_is_a_cell_ref() {
    // "LOG10" is a valid A1 spelling (column LOG, row 10); only `LOG10(`
    // is a function call. Same rule as Excel.
    assert!(matches!(parse("LOG10").unwrap(), Expr::CellRef { .. }));
    assert!(matches!(parse("LOG10(2)").unwrap(), Expr::Call { .. }));
}

// ---------- precedence & associativity ----------

#[test]
fn precedence_mul_over_add() {
    // 1+2*3 = 1+(2*3)
    assert_eq!(
        parse("1+2*3").unwrap(),
        bin(
            BinaryOp::Add,
            num(1.0),
            bin(BinaryOp::Mul, num(2.0), num(3.0))
        )
    );
}

#[test]
fn precedence_parens_override() {
    assert_eq!(
        parse("(1+2)*3").unwrap(),
        bin(
            BinaryOp::Mul,
            bin(BinaryOp::Add, num(1.0), num(2.0)),
            num(3.0)
        )
    );
}

#[test]
fn precedence_pow_over_mul() {
    // 2*3^2 = 2*(3^2)
    assert_eq!(
        parse("2*3^2").unwrap(),
        bin(
            BinaryOp::Mul,
            num(2.0),
            bin(BinaryOp::Pow, num(3.0), num(2.0))
        )
    );
}

#[test]
fn precedence_unary_minus_over_pow() {
    // Excel: -2^2 = (-2)^2 = 4
    assert_eq!(
        parse("-2^2").unwrap(),
        bin(BinaryOp::Pow, neg(num(2.0)), num(2.0))
    );
}

#[test]
fn precedence_percent_postfix() {
    // -50%*2 → (-(50%))*2
    assert_eq!(
        parse("-50%*2").unwrap(),
        bin(
            BinaryOp::Mul,
            neg(Expr::Percent(Box::new(num(50.0)))),
            num(2.0)
        )
    );
}

#[test]
fn precedence_concat_over_add() {
    // 1&2+3 → 1&(2+3)
    assert_eq!(
        parse("1&2+3").unwrap(),
        bin(
            BinaryOp::Concat,
            num(1.0),
            bin(BinaryOp::Add, num(2.0), num(3.0))
        )
    );
}

#[test]
fn precedence_comparison_loosest() {
    // 1+2>3&"x" → (1+2) > (3&"x")
    assert_eq!(
        parse("1+2>3&\"x\"").unwrap(),
        bin(
            BinaryOp::Gt,
            bin(BinaryOp::Add, num(1.0), num(2.0)),
            bin(BinaryOp::Concat, num(3.0), text("x"))
        )
    );
}

#[test]
fn comparison_ops_all() {
    for (s, op) in [
        ("1=2", BinaryOp::Eq),
        ("1<>2", BinaryOp::Ne),
        ("1<2", BinaryOp::Lt),
        ("1<=2", BinaryOp::Le),
        ("1>2", BinaryOp::Gt),
        ("1>=2", BinaryOp::Ge),
    ] {
        assert_eq!(parse(s).unwrap(), bin(op, num(1.0), num(2.0)), "input {s}");
    }
}

#[test]
fn associativity_add_sub_left() {
    // 1-2-3 = (1-2)-3
    assert_eq!(
        parse("1-2-3").unwrap(),
        bin(
            BinaryOp::Sub,
            bin(BinaryOp::Sub, num(1.0), num(2.0)),
            num(3.0)
        )
    );
}

#[test]
fn associativity_pow_left() {
    // Excel: 2^3^2 = (2^3)^2 = 64
    assert_eq!(
        parse("2^3^2").unwrap(),
        bin(
            BinaryOp::Pow,
            bin(BinaryOp::Pow, num(2.0), num(3.0)),
            num(2.0)
        )
    );
}

#[test]
fn associativity_comparison_left() {
    assert_eq!(
        parse("1=2=3").unwrap(),
        bin(
            BinaryOp::Eq,
            bin(BinaryOp::Eq, num(1.0), num(2.0)),
            num(3.0)
        )
    );
}

#[test]
fn unary_chain() {
    assert_eq!(parse("--1").unwrap(), neg(neg(num(1.0))));
    assert_eq!(
        parse("+-1").unwrap(),
        Expr::Unary {
            op: UnaryOp::Pos,
            operand: Box::new(neg(num(1.0)))
        }
    );
}

#[test]
fn unary_on_pow_rhs() {
    // 2^-3 → 2^(-3)
    assert_eq!(
        parse("2^-3").unwrap(),
        bin(BinaryOp::Pow, num(2.0), neg(num(3.0)))
    );
}

#[test]
fn percent_chains() {
    assert_eq!(
        parse("50%%").unwrap(),
        Expr::Percent(Box::new(Expr::Percent(Box::new(num(50.0)))))
    );
}

// ---------- references ----------

#[test]
fn parse_cell_ref() {
    assert_eq!(parse("A1").unwrap(), cell(0, 0));
    assert_eq!(parse("c10").unwrap(), cell(2, 9));
}

#[test]
fn parse_cell_ref_absolute() {
    match parse("$B$5").unwrap() {
        Expr::CellRef { cell, sheet } => {
            assert!(cell.row_abs && cell.col_abs);
            assert_eq!((cell.row, cell.col), (4, 1));
            assert_eq!(sheet, None);
        }
        e => panic!("expected cellref, got {e:?}"),
    }
}

#[test]
fn parse_range_ref() {
    match parse("A1:B10").unwrap() {
        Expr::RangeRef { range, sheet } => {
            assert_eq!((range.start.row, range.start.col), (0, 0));
            assert_eq!((range.end.row, range.end.col), (9, 1));
            assert_eq!(sheet, None);
        }
        e => panic!("expected range, got {e:?}"),
    }
}

#[test]
fn parse_range_in_call() {
    match parse("SUM(A1:A3)").unwrap() {
        Expr::Call { name, args } => {
            assert_eq!(name, "SUM");
            assert!(matches!(args[0], Expr::RangeRef { .. }));
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn parse_sheet_qualified_cell() {
    match parse("Sheet1!B2").unwrap() {
        Expr::CellRef { sheet, cell } => {
            assert_eq!(sheet.as_deref(), Some("Sheet1"));
            assert_eq!((cell.row, cell.col), (1, 1));
        }
        e => panic!("expected cellref, got {e:?}"),
    }
}

#[test]
fn parse_sheet_qualified_quoted() {
    match parse("'Sales 2026'!A1").unwrap() {
        Expr::CellRef { sheet, .. } => {
            assert_eq!(sheet.as_deref(), Some("Sales 2026"));
        }
        e => panic!("expected cellref, got {e:?}"),
    }
}

#[test]
fn parse_sheet_qualified_range() {
    match parse("S!A1:B2").unwrap() {
        Expr::RangeRef { sheet, range } => {
            assert_eq!(sheet.as_deref(), Some("S"));
            assert_eq!(range.cell_count(), 4);
        }
        e => panic!("expected range, got {e:?}"),
    }
}

#[test]
fn parse_cellref_case_insensitive_bounds() {
    assert!(parse("XFD1048576").is_ok());
    // beyond the grid → classified as a defined name, not an error
    assert_eq!(parse("XFE1").unwrap(), Expr::Name("XFE1".into()));
    assert!(parse("A1048577").is_ok()); // also a Name
}

// ---------- function calls ----------

#[test]
fn parse_call_no_args() {
    match parse("TODAY()").unwrap() {
        Expr::Call { name, args } => {
            assert_eq!(name, "TODAY");
            assert!(args.is_empty());
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn parse_call_multi_args() {
    match parse("IF(A1>0,1,-1)").unwrap() {
        Expr::Call { name, args } => {
            assert_eq!(name, "IF");
            assert_eq!(args.len(), 3);
            assert_eq!(args[2], neg(num(1.0)));
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn parse_call_missing_args() {
    match parse("IF(A1,,3)").unwrap() {
        Expr::Call { args, .. } => {
            assert_eq!(args.len(), 3);
            assert!(matches!(args[1], Expr::Missing));
        }
        e => panic!("expected call, got {e:?}"),
    }
    match parse("F(,)").unwrap() {
        Expr::Call { args, .. } => {
            assert_eq!(args.len(), 2);
            assert!(matches!(args[0], Expr::Missing));
            assert!(matches!(args[1], Expr::Missing));
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn parse_call_trailing_missing() {
    match parse("IF(A1,)").unwrap() {
        Expr::Call { args, .. } => {
            assert_eq!(args.len(), 2);
            assert!(matches!(args[1], Expr::Missing));
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn parse_nested_calls() {
    match parse("MAX(SUM(A1,B1),2)").unwrap() {
        Expr::Call { name, args } => {
            assert_eq!(name, "MAX");
            assert!(matches!(&args[0], Expr::Call { name, .. } if name == "SUM"));
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn parse_dotted_function_name() {
    match parse("STDEV.S(A1:A3)").unwrap() {
        Expr::Call { name, .. } => assert_eq!(name, "STDEV.S"),
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn true_call_is_function() {
    // TRUE() is a function call, not a bool literal.
    match parse("TRUE()").unwrap() {
        Expr::Call { name, args } => {
            assert_eq!(name, "TRUE");
            assert!(args.is_empty());
        }
        e => panic!("expected call, got {e:?}"),
    }
}

// ---------- whitespace ----------

#[test]
fn whitespace_ignored() {
    assert_eq!(
        parse("  1 + 2 ").unwrap(),
        bin(BinaryOp::Add, num(1.0), num(2.0))
    );
    assert_eq!(
        parse("SUM( A1 , B2 )").unwrap(),
        call("SUM", vec![cell(0, 0), cell(1, 1)])
    );
}

#[test]
fn whitespace_between_refs_is_error_not_intersection() {
    // Excel's space-intersection operator is not supported (SPEC-OPEN).
    assert!(matches!(
        parse("A1 B2"),
        Err(calc_core::ParseError {
            kind: ParseErrorKind::UnexpectedToken,
            ..
        })
    ));
}

// ---------- invalid input ----------

fn err_kind(src: &str) -> ParseErrorKind {
    parse(src).unwrap_err().kind
}

#[test]
fn err_empty() {
    assert_eq!(err_kind(""), ParseErrorKind::EmptyFormula);
    assert_eq!(err_kind("="), ParseErrorKind::EmptyFormula);
    assert_eq!(err_kind("   "), ParseErrorKind::EmptyFormula);
}

#[test]
fn err_unexpected_eot() {
    assert_eq!(err_kind("1+"), ParseErrorKind::UnexpectedEof);
    assert_eq!(err_kind("("), ParseErrorKind::UnexpectedEof);
    assert_eq!(err_kind("-"), ParseErrorKind::UnexpectedEof);
}

#[test]
fn err_unclosed_paren() {
    assert_eq!(err_kind("(1+2"), ParseErrorKind::UnexpectedEof);
    assert_eq!(err_kind("SUM(1,2"), ParseErrorKind::UnexpectedEof);
}

#[test]
fn err_unexpected_token() {
    for s in ["1++", "*2", "1 2", ")", "A1,B2", "1,,2"] {
        let k = err_kind(s);
        assert!(
            matches!(
                k,
                ParseErrorKind::UnexpectedToken | ParseErrorKind::UnexpectedEof
            ),
            "input {s:?}: {k:?}"
        );
    }
}

#[test]
fn err_colon_misuse() {
    for s in [":A1", "A1:", "A1:B2:C3", "SUM(A1):B2", "TRUE:B2"] {
        assert!(parse(s).is_err(), "input {s:?} should fail");
    }
}

#[test]
fn err_bad_sheet_forms() {
    for s in [
        "Sheet1!",
        "Sheet1!xyz",
        "'Unclosed!A1",
        "'Orphan'",
        "1!A1",
        "Sheet1!A1:Sheet1!B2",
    ] {
        assert!(parse(s).is_err(), "input {s:?} should fail");
    }
}

#[test]
fn err_invalid_function_name() {
    assert_eq!(err_kind("$A$1(2)"), ParseErrorKind::InvalidFunctionName);
    // "1abc" lexes as `1` `abc` → fails before the call is even attempted
    assert_eq!(err_kind("1abc(2)"), ParseErrorKind::UnexpectedToken);
}

#[test]
fn err_lexical() {
    assert!(matches!(
        err_kind("1@2"),
        ParseErrorKind::Lex(LexErrorKind::UnexpectedChar('@'))
    ));
    assert!(matches!(
        err_kind("\"x"),
        ParseErrorKind::Lex(LexErrorKind::UnterminatedString)
    ));
}

#[test]
fn err_reports_offset() {
    let e = parse("1+2*").unwrap_err();
    assert_eq!(e.offset, 4);
    let e = parse("1@2").unwrap_err();
    assert_eq!(e.offset, 1);
}

#[test]
fn err_offset_counts_leading_equals() {
    assert_eq!(parse("==1").unwrap_err().offset, 1);
    assert_eq!(parse("=1+").unwrap_err().offset, 3);
    assert_eq!(parse("=SUM(1,").unwrap_err().offset, 7);
    assert_eq!(parse("=1@2").unwrap_err().offset, 2);
}

// ---------- limits ----------

#[test]
fn limit_formula_too_long() {
    let src = "1".repeat(MAX_FORMULA_LEN + 1);
    assert_eq!(err_kind(&src), ParseErrorKind::FormulaTooLong);
    // exactly at the limit is fine
    let ok = format!("{}+", "1".repeat(MAX_FORMULA_LEN - 2));
    assert!(parse(&ok).is_err()); // ends with '+' → Eof error, but not length
    assert_ne!(err_kind(&ok), ParseErrorKind::FormulaTooLong);
}

#[test]
fn limit_nesting_depth() {
    // Each '(' consumes several depth slots (comparison + unary + primary),
    // so MAX_DEPTH parens far exceeds the limit while MAX_DEPTH/4 fits.
    let too_many = MAX_DEPTH;
    let src = format!("{}1{}", "(".repeat(too_many), ")".repeat(too_many));
    assert_eq!(err_kind(&src), ParseErrorKind::TooDeep);
    let n = MAX_DEPTH / 4;
    let ok = format!("{}1{}", "(".repeat(n), ")".repeat(n));
    assert!(parse(&ok).is_ok());
}

#[test]
fn limit_ast_nodes() {
    // `1` followed by N '%' produces N+1 nodes from N+1 tokens — the
    // densest node/token ratio available (MAX_TOKENS > MAX_AST_NODES).
    let src = format!("1{}", "%".repeat(MAX_AST_NODES + 5));
    assert_eq!(err_kind(&src), ParseErrorKind::TooManyNodes);
}

#[test]
fn limit_token_count() {
    // tokens: N ones + (N-1) pluses; pick N so tokens > MAX_TOKENS
    let n = MAX_TOKENS / 2 + 5;
    let src = vec!["1"; n].join("+");
    let err = parse(&src).unwrap_err();
    // whichever limit hits first — must be a limit error, not a panic
    assert!(matches!(
        err.kind,
        ParseErrorKind::Lex(LexErrorKind::TooManyTokens) | ParseErrorKind::TooManyNodes
    ));
}

#[test]
fn deep_unary_chain_within_limit() {
    let src = "-".repeat(100) + "1";
    assert!(parse(&src).is_ok());
}

// ---------- AST shape sanity ----------

#[test]
fn ast_node_count() {
    // 1+2*3 → add(1, mul(2,3)) = 5 nodes
    assert_eq!(parse("1+2*3").unwrap().node_count(), 5);
    // SUM(A1:B2,1) → call + range + num = 3
    assert_eq!(parse("SUM(A1:B2,1)").unwrap().node_count(), 3);
}

#[test]
fn golden_parse_1_plus_2_times_3() {
    // The §10.2 golden example at AST level.
    let e = parse("=1+2*3").unwrap();
    match e {
        Expr::Binary {
            op: BinaryOp::Add,
            left,
            right,
        } => {
            assert_eq!(*left, num(1.0));
            assert!(matches!(
                *right,
                Expr::Binary {
                    op: BinaryOp::Mul,
                    ..
                }
            ));
        }
        _ => panic!("unexpected AST: {e:?}"),
    }
}

// ---------- additional coverage ----------

#[test]
fn lex_unicode_string_and_name() {
    assert_eq!(kinds("\"沖縄県\"")[0], TokenKind::Str("沖縄県".into()));
    assert_eq!(kinds("シート1")[0], TokenKind::Word("シート1".into()));
}

#[test]
fn lex_number_then_word() {
    // `1e` with no exponent digits: number ends before 'e'.
    let ks = kinds("1e");
    assert_eq!(ks[0], TokenKind::Number(1.0));
    assert_eq!(ks[1], TokenKind::Word("e".into()));
}

#[test]
fn lex_offsets_multibyte() {
    let toks = lex("\"あ\"+1", MAX_TOKENS).unwrap();
    // string token at 0; '+' at byte 5 (quote + 3-byte char + quote)
    assert_eq!(toks[1].offset, 5);
}

#[test]
fn percent_on_call_and_paren() {
    assert_eq!(
        parse("SUM(1)%").unwrap(),
        Expr::Percent(Box::new(call("SUM", vec![num(1.0)])))
    );
    assert_eq!(
        parse("(1+1)%").unwrap(),
        Expr::Percent(Box::new(bin(BinaryOp::Add, num(1.0), num(1.0))))
    );
}

#[test]
fn comparison_inside_call_args() {
    match parse("IF(A1>0,\"y\",\"n\")").unwrap() {
        Expr::Call { args, .. } => {
            assert!(matches!(
                args[0],
                Expr::Binary {
                    op: BinaryOp::Gt,
                    ..
                }
            ));
            assert_eq!(args[1], text("y"));
        }
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn concat_chains() {
    // "a"&"b"&"c" is left-associative
    match parse("\"a\"&\"b\"&\"c\"").unwrap() {
        Expr::Binary {
            op: BinaryOp::Concat,
            left,
            ..
        } => assert!(matches!(
            *left,
            Expr::Binary {
                op: BinaryOp::Concat,
                ..
            }
        )),
        e => panic!("expected concat, got {e:?}"),
    }
}

#[test]
fn error_literal_in_expression() {
    assert_eq!(
        parse("IFERROR(#N/A,1)").unwrap(),
        call(
            "IFERROR",
            vec![Expr::Literal(Literal::Error(CalcError::NA)), num(1.0)]
        )
    );
}

#[test]
fn mixed_ref_in_range_and_math() {
    match parse("SUM($A$1:$B2)*2").unwrap() {
        Expr::Binary {
            op: BinaryOp::Mul, ..
        } => {}
        e => panic!("expected mul, got {e:?}"),
    }
}

#[test]
fn quoted_sheet_name_with_escape() {
    match parse("'O''Brien'!A1").unwrap() {
        Expr::CellRef { sheet, .. } => assert_eq!(sheet.as_deref(), Some("O'Brien")),
        e => panic!("expected cellref, got {e:?}"),
    }
}

#[test]
fn sheet_name_case_and_digits() {
    for s in ["Sheet1!A1", "SHEET_1!A1", "_private!A1", "シート!A1"] {
        assert!(
            matches!(parse(s), Ok(Expr::CellRef { .. })),
            "input {s:?} should parse"
        );
    }
}

#[test]
fn name_with_dots_and_digits() {
    assert_eq!(
        parse("_xll.foo.bar2").unwrap(),
        Expr::Name("_xll.foo.bar2".into())
    );
}

#[test]
fn unary_plus_is_kept_in_ast() {
    assert_eq!(
        parse("+1").unwrap(),
        Expr::Unary {
            op: UnaryOp::Pos,
            operand: Box::new(num(1.0))
        }
    );
}

#[test]
fn div_and_sub_precedence() {
    // 10/2-1 = (10/2)-1
    assert_eq!(
        parse("10/2-1").unwrap(),
        bin(
            BinaryOp::Sub,
            bin(BinaryOp::Div, num(10.0), num(2.0)),
            num(1.0)
        )
    );
}

#[test]
fn concat_binds_looser_than_mul() {
    // 2*3&4 → (2*3)&4
    assert_eq!(
        parse("2*3&4").unwrap(),
        bin(
            BinaryOp::Concat,
            bin(BinaryOp::Mul, num(2.0), num(3.0)),
            num(4.0)
        )
    );
}

#[test]
fn range_end_with_dollar_markers() {
    match parse("A$1:$B2").unwrap() {
        Expr::RangeRef { range, .. } => {
            assert!(!range.start.col_abs && range.start.row_abs);
            assert!(range.end.col_abs && !range.end.row_abs);
        }
        e => panic!("expected range, got {e:?}"),
    }
}

#[test]
fn deep_call_nesting() {
    let src = "F(".repeat(20) + "1" + &")".repeat(20);
    match parse(&src).unwrap() {
        Expr::Call { name, .. } => assert_eq!(name, "F"),
        e => panic!("expected call, got {e:?}"),
    }
}

#[test]
fn err_double_bang() {
    assert!(parse("A!!B1").is_err());
    assert!(parse("S1!!A1").is_err());
}

#[test]
fn err_orphan_quoted_name_kind() {
    assert_eq!(err_kind("'S 1'"), ParseErrorKind::OrphanQuotedName);
}

#[test]
fn err_range_endpoint_missing() {
    assert!(matches!(
        err_kind("A1:"),
        ParseErrorKind::Expected(_) | ParseErrorKind::UnexpectedEof
    ));
}

#[test]
fn err_call_unexpected_arg_separator() {
    // Semicolon separators (European locale) are not supported.
    assert!(parse("SUM(1;2)").is_err());
}

#[test]
fn err_bang_inside_call() {
    assert!(parse("SUM(A1!B2)").is_err());
}

#[test]
fn err_trailing_percent_of_nothing() {
    assert!(parse("%").is_err());
    assert!(parse("+%").is_err());
}

#[test]
fn parse_very_long_flat_expression() {
    // 2000-term sum: comfortably under all limits.
    let src = vec!["A1"; 2000].join("+");
    assert!(parse(&src).is_ok());
}

#[test]
fn whitespace_only_inside_parens_errors() {
    assert!(parse("( )").is_err());
}

#[test]
fn cell_ref_used_twice_same_node() {
    // A1+A1: two distinct CellRef nodes
    match parse("A1+A1").unwrap() {
        Expr::Binary { left, right, .. } => {
            assert!(matches!(*left, Expr::CellRef { .. }));
            assert!(matches!(*right, Expr::CellRef { .. }));
        }
        e => panic!("expected binary, got {e:?}"),
    }
}
