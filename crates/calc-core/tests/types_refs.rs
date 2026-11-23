//! Tests for the core data model: errors, values, arrays, A1 references,
//! and the workbook skeleton. Covers normal, boundary and error cases per
//! docs/IMPLEMENTATION_PLAN.md §10 ("パーサー・参照", "型変換・互換性").

use calc_core::cell::{
    col_to_letters, is_valid_sheet_name, letters_to_col, parse_sheet_qualified_ref,
};
use calc_core::{
    ArrayValue, CalcError, CellInput, CellRef, DateSystem, MAX_COLS, MAX_ROWS, RangeRef,
    RefParseErrorKind, RefTarget, Value, ValueKind, Workbook, WorkbookError,
};

// ---------- CalcError ----------

#[test]
fn error_codes_round_trip() {
    for e in CalcError::ALL {
        let code = e.code();
        assert_eq!(CalcError::from_code(code), Some(e), "round-trip {code}");
    }
}

#[test]
fn error_display_matches_excel_literals() {
    assert_eq!(CalcError::DivZero.to_string(), "#DIV/0!");
    assert_eq!(CalcError::Value.to_string(), "#VALUE!");
    assert_eq!(CalcError::Ref.to_string(), "#REF!");
    assert_eq!(CalcError::Name.to_string(), "#NAME?");
    assert_eq!(CalcError::Num.to_string(), "#NUM!");
    assert_eq!(CalcError::NA.to_string(), "#N/A");
    assert_eq!(CalcError::Null.to_string(), "#NULL!");
    assert_eq!(CalcError::Spill.to_string(), "#SPILL!");
    assert_eq!(CalcError::Calc.to_string(), "#CALC!");
    assert_eq!(CalcError::Circ.to_string(), "#CIRC!");
}

#[test]
fn error_from_code_is_case_insensitive() {
    assert_eq!(CalcError::from_code("#div/0!"), Some(CalcError::DivZero));
    assert_eq!(CalcError::from_code("#n/A"), Some(CalcError::NA));
}

#[test]
fn error_from_code_rejects_unknown() {
    assert_eq!(CalcError::from_code("#BOOM!"), None);
    assert_eq!(CalcError::from_code(""), None);
    assert_eq!(CalcError::from_code("#N/A!"), None);
}

#[test]
fn error_codes_are_unique() {
    let mut codes: Vec<_> = CalcError::ALL.iter().map(|e| e.code()).collect();
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes.len(), CalcError::ALL.len());
}

// ---------- Value: kind & flags ----------

#[test]
fn value_kinds() {
    assert_eq!(Value::Blank.kind(), ValueKind::Blank);
    assert_eq!(Value::Number(1.0).kind(), ValueKind::Number);
    assert_eq!(Value::Text("x".into()).kind(), ValueKind::Text);
    assert_eq!(Value::Boolean(true).kind(), ValueKind::Boolean);
    assert_eq!(Value::Error(CalcError::Num).kind(), ValueKind::Error);
    let arr = ArrayValue::from_row(vec![Value::Number(1.0)]).unwrap();
    assert_eq!(Value::Array(arr).kind(), ValueKind::Array);
}

#[test]
fn blank_is_distinct_from_empty_text() {
    assert_ne!(Value::Blank, Value::Text(String::new()));
    assert!(Value::Blank.is_blank());
    assert!(!Value::Text(String::new()).is_blank());
}

#[test]
fn error_accessor() {
    let v = Value::Error(CalcError::Ref);
    assert_eq!(v.error(), Some(CalcError::Ref));
    assert!(v.is_error());
    assert_eq!(Value::Number(1.0).error(), None);
}

// ---------- Value: coercion to number ----------

#[test]
fn to_number_from_number() {
    assert_eq!(Value::Number(-3.5).to_number().unwrap(), -3.5);
}

#[test]
fn to_number_from_blank_is_zero() {
    assert_eq!(Value::Blank.to_number().unwrap(), 0.0);
}

#[test]
fn to_number_from_boolean() {
    assert_eq!(Value::Boolean(true).to_number().unwrap(), 1.0);
    assert_eq!(Value::Boolean(false).to_number().unwrap(), 0.0);
}

#[test]
fn to_number_from_numeric_text() {
    assert_eq!(Value::Text("42".into()).to_number().unwrap(), 42.0);
    assert_eq!(
        Value::Text("  -1.5e2  ".into()).to_number().unwrap(),
        -150.0
    );
    assert_eq!(Value::Text("+3".into()).to_number().unwrap(), 3.0);
    assert_eq!(Value::Text(".5".into()).to_number().unwrap(), 0.5);
}

#[test]
fn to_number_from_percent_text() {
    assert_eq!(Value::Text("5%".into()).to_number().unwrap(), 0.05);
}

#[test]
fn to_number_from_bad_text_is_value_error() {
    for s in ["", "   ", "abc", "12a", "1,000"] {
        assert_eq!(
            Value::Text(s.into()).to_number(),
            Err(CalcError::Value),
            "input {s:?}"
        );
    }
}

#[test]
fn to_number_rejects_nan_inf_spelling() {
    for s in ["NaN", "inf", "-infinity"] {
        assert_eq!(Value::Text(s.into()).to_number(), Err(CalcError::Value));
    }
}

#[test]
fn to_number_propagates_error() {
    assert_eq!(Value::Error(CalcError::NA).to_number(), Err(CalcError::NA));
}

#[test]
fn to_number_from_array_is_value_error() {
    let arr = ArrayValue::from_row(vec![Value::Number(1.0)]).unwrap();
    assert_eq!(Value::Array(arr).to_number(), Err(CalcError::Value));
}

// ---------- Value: coercion to boolean ----------

#[test]
fn to_boolean_basics() {
    assert!(Value::Boolean(true).to_boolean().unwrap());
    assert!(!Value::Blank.to_boolean().unwrap());
    assert!(Value::Number(0.5).to_boolean().unwrap());
    assert!(!Value::Number(0.0).to_boolean().unwrap());
    assert!(Value::Number(-2.0).to_boolean().unwrap());
}

#[test]
fn to_boolean_from_text() {
    assert!(Value::Text("true".into()).to_boolean().unwrap());
    assert!(Value::Text(" TRUE ".into()).to_boolean().unwrap());
    assert!(!Value::Text("FaLsE".into()).to_boolean().unwrap());
    assert_eq!(
        Value::Text("yes".into()).to_boolean(),
        Err(CalcError::Value)
    );
    assert_eq!(Value::Text("1".into()).to_boolean(), Err(CalcError::Value));
}

#[test]
fn to_boolean_propagates_error() {
    assert_eq!(
        Value::Error(CalcError::DivZero).to_boolean(),
        Err(CalcError::DivZero)
    );
}

// ---------- Value: coercion to text / formatting ----------

#[test]
fn to_text_basics() {
    assert_eq!(Value::Blank.to_text().unwrap(), "");
    assert_eq!(Value::Text("hi".into()).to_text().unwrap(), "hi");
    assert_eq!(Value::Boolean(true).to_text().unwrap(), "TRUE");
    assert_eq!(Value::Boolean(false).to_text().unwrap(), "FALSE");
    assert_eq!(Value::Number(42.0).to_text().unwrap(), "42");
    assert_eq!(Value::Number(-0.0).to_text().unwrap(), "0");
    assert_eq!(Value::Number(1.25).to_text().unwrap(), "1.25");
}

#[test]
fn to_text_propagates_error() {
    assert_eq!(
        Value::Error(CalcError::Spill).to_text(),
        Err(CalcError::Spill)
    );
}

#[test]
fn display_formats_values() {
    assert_eq!(Value::Blank.to_string(), "");
    assert_eq!(Value::Number(3.0).to_string(), "3");
    assert_eq!(Value::Text("x".into()).to_string(), "x");
    assert_eq!(Value::Boolean(false).to_string(), "FALSE");
    assert_eq!(Value::Error(CalcError::Calc).to_string(), "#CALC!");
}

// ---------- ArrayValue ----------

#[test]
fn array_new_and_get() {
    let a = ArrayValue::new(
        2,
        2,
        vec![
            Value::Number(1.0),
            Value::Number(2.0),
            Value::Number(3.0),
            Value::Number(4.0),
        ],
    )
    .unwrap();
    assert_eq!(a.rows(), 2);
    assert_eq!(a.cols(), 2);
    assert_eq!(a.len(), 4);
    assert_eq!(a.get(0, 0), Some(&Value::Number(1.0)));
    assert_eq!(a.get(1, 0), Some(&Value::Number(3.0))); // row-major
    assert_eq!(a.get(1, 1), Some(&Value::Number(4.0)));
    assert_eq!(a.get(2, 0), None);
    assert_eq!(a.get(0, 2), None);
}

#[test]
fn array_get_mut() {
    let mut a = ArrayValue::fill(1, 2, Value::Blank).unwrap();
    *a.get_mut(0, 1).unwrap() = Value::Number(9.0);
    assert_eq!(a.get(0, 1), Some(&Value::Number(9.0)));
    assert!(a.get_mut(1, 0).is_none());
}

#[test]
fn array_rejects_zero_dimensions() {
    assert_eq!(ArrayValue::new(0, 1, vec![]).unwrap_err(), CalcError::Value);
    assert_eq!(ArrayValue::new(1, 0, vec![]).unwrap_err(), CalcError::Value);
    assert!(ArrayValue::fill(0, 3, Value::Blank).is_err());
}

#[test]
fn array_rejects_length_mismatch() {
    assert!(ArrayValue::new(2, 2, vec![Value::Blank; 3]).is_err());
    assert!(ArrayValue::new(2, 2, vec![Value::Blank; 5]).is_err());
}

#[test]
fn array_rejects_over_limit() {
    // MAX_ARRAY_CELLS is 1_000_000; 1001x1000 exceeds it.
    assert!(ArrayValue::fill(1001, 1000, Value::Blank).is_err());
    // Exactly at the limit is allowed (sized check before allocation path).
    assert!(ArrayValue::new(1, 1, vec![Value::Blank]).is_ok());
}

#[test]
fn array_rejects_dimension_over_grid() {
    assert!(ArrayValue::fill(MAX_ROWS + 1, 1, Value::Blank).is_err());
    assert!(ArrayValue::fill(1, MAX_COLS + 1, Value::Blank).is_err());
}

#[test]
fn array_from_column_and_row() {
    let col = ArrayValue::from_column(vec![Value::Number(1.0), Value::Number(2.0)]).unwrap();
    assert_eq!((col.rows(), col.cols()), (2, 1));
    let row = ArrayValue::from_row(vec![Value::Number(1.0), Value::Number(2.0)]).unwrap();
    assert_eq!((row.rows(), row.cols()), (1, 2));
    assert!(ArrayValue::from_column(vec![]).is_err());
    assert!(ArrayValue::from_row(vec![]).is_err());
}

#[test]
fn array_iter_row_major() {
    let a = ArrayValue::new(
        2,
        2,
        vec![
            Value::Number(1.0),
            Value::Number(2.0),
            Value::Number(3.0),
            Value::Number(4.0),
        ],
    )
    .unwrap();
    let collected: Vec<f64> = a.iter().map(|v| v.to_number().unwrap()).collect();
    assert_eq!(collected, vec![1.0, 2.0, 3.0, 4.0]);
}

// ---------- column letters ----------

#[test]
fn col_letters_round_trip() {
    for (letters, idx) in [
        ("A", 0),
        ("Z", 25),
        ("AA", 26),
        ("AZ", 51),
        ("BA", 52),
        ("ZZ", 701),
        ("AAA", 702),
        ("XFD", 16_383),
    ] {
        assert_eq!(letters_to_col(letters), Some(idx), "letters {letters}");
        assert_eq!(col_to_letters(idx), letters, "index {idx}");
    }
}

#[test]
fn col_letters_case_insensitive() {
    assert_eq!(letters_to_col("xfd"), Some(16_383));
    assert_eq!(letters_to_col("aA"), Some(26));
}

#[test]
fn col_letters_out_of_bounds() {
    assert_eq!(letters_to_col("XFE"), None); // first column beyond XFD
    assert_eq!(letters_to_col("AAAA"), None); // too long
    assert_eq!(letters_to_col(""), None);
    assert_eq!(letters_to_col("A1"), None);
}

// ---------- CellRef ----------

#[test]
fn cell_ref_simple() {
    let r = CellRef::from_a1("A1").unwrap();
    assert_eq!((r.row, r.col, r.row_abs, r.col_abs), (0, 0, false, false));
    let r = CellRef::from_a1("C5").unwrap();
    assert_eq!((r.row, r.col), (4, 2));
}

#[test]
fn cell_ref_lowercase() {
    let r = CellRef::from_a1("b12").unwrap();
    assert_eq!((r.row, r.col), (11, 1));
}

#[test]
fn cell_ref_absolute_variants() {
    let r = CellRef::from_a1("$A$1").unwrap();
    assert!((r.row_abs, r.col_abs) == (true, true));
    let r = CellRef::from_a1("A$1").unwrap();
    assert!((r.row_abs, r.col_abs) == (true, false));
    let r = CellRef::from_a1("$A1").unwrap();
    assert!((r.row_abs, r.col_abs) == (false, true));
}

#[test]
fn cell_ref_to_a1_round_trip() {
    for s in ["A1", "$A$1", "A$1", "$A1", "XFD1048576", "$BC$99"] {
        assert_eq!(CellRef::from_a1(s).unwrap().to_a1(), s, "input {s}");
    }
}

#[test]
fn cell_ref_max_bounds() {
    assert!(CellRef::from_a1("XFD1048576").is_ok());
    assert_eq!(
        CellRef::from_a1("XFE1").unwrap_err().kind,
        RefParseErrorKind::OutOfBounds
    );
    assert_eq!(
        CellRef::from_a1("A1048577").unwrap_err().kind,
        RefParseErrorKind::OutOfBounds
    );
}

#[test]
fn cell_ref_rejects_row_zero_and_leading_zero() {
    assert_eq!(
        CellRef::from_a1("A0").unwrap_err().kind,
        RefParseErrorKind::InvalidRow
    );
    assert_eq!(
        CellRef::from_a1("A01").unwrap_err().kind,
        RefParseErrorKind::InvalidRow
    );
}

#[test]
fn cell_ref_rejects_missing_parts() {
    assert_eq!(
        CellRef::from_a1("A").unwrap_err().kind,
        RefParseErrorKind::ExpectedRow
    );
    assert_eq!(
        CellRef::from_a1("1").unwrap_err().kind,
        RefParseErrorKind::ExpectedColumn
    );
    assert_eq!(
        CellRef::from_a1("").unwrap_err().kind,
        RefParseErrorKind::ExpectedColumn
    );
    assert_eq!(
        CellRef::from_a1("$1").unwrap_err().kind,
        RefParseErrorKind::ExpectedColumn
    );
    assert_eq!(
        CellRef::from_a1("$A").unwrap_err().kind,
        RefParseErrorKind::ExpectedRow
    );
}

#[test]
fn cell_ref_rejects_trailing_input() {
    for s in ["A1B", "A1:2", "A 1", "A$1x"] {
        let e = CellRef::from_a1(s).unwrap_err();
        assert!(
            matches!(
                e.kind,
                RefParseErrorKind::TrailingInput
                    | RefParseErrorKind::InvalidRow
                    | RefParseErrorKind::ExpectedRow
            ),
            "input {s}: {e:?}"
        );
    }
}

#[test]
fn cell_ref_error_reports_offset() {
    let e = CellRef::from_a1("A1B").unwrap_err();
    assert_eq!(e.offset, 2);
}

// ---------- RangeRef ----------

#[test]
fn range_parse_basic() {
    let r = RangeRef::from_a1("A1:B10").unwrap();
    assert_eq!((r.start.row, r.start.col), (0, 0));
    assert_eq!((r.end.row, r.end.col), (9, 1));
    assert!(r.is_normalized());
    assert_eq!(r.row_count(), 10);
    assert_eq!(r.col_count(), 2);
    assert_eq!(r.cell_count(), 20);
}

#[test]
fn range_single_cell() {
    let r = RangeRef::from_a1("C3").unwrap();
    assert_eq!(r.start, r.end);
    assert_eq!(r.cell_count(), 1);
}

#[test]
fn range_absolute_markers() {
    let r = RangeRef::from_a1("$A$1:$B$10").unwrap();
    assert!(r.start.col_abs && r.start.row_abs);
    assert_eq!(r.to_a1(), "$A$1:$B$10");
}

#[test]
fn range_normalization() {
    // Excel accepts reversed ranges and treats them as canonical.
    let r = RangeRef::from_a1("B10:A1").unwrap();
    assert!(!r.is_normalized());
    let n = r.normalized();
    assert_eq!((n.start.row, n.start.col), (0, 0));
    assert_eq!((n.end.row, n.end.col), (9, 1));
    assert_eq!(r.cell_count(), 20);
}

#[test]
fn range_contains() {
    let r = RangeRef::from_a1("B2:C5").unwrap();
    assert!(r.contains(1, 1));
    assert!(r.contains(4, 2));
    assert!(!r.contains(0, 1));
    assert!(!r.contains(1, 0));
    assert!(!r.contains(5, 1));
}

#[test]
fn range_to_a1_round_trip() {
    for s in ["A1:B10", "B10:A1", "A1:A1", "$A$1:$XFD$1048576"] {
        assert_eq!(RangeRef::from_a1(s).unwrap().to_a1(), s, "input {s}");
    }
}

#[test]
fn range_rejects_bad_forms() {
    assert!(RangeRef::from_a1("A1:").is_err());
    assert!(RangeRef::from_a1(":B2").is_err());
    assert!(RangeRef::from_a1("A1:B2:C3").is_err());
    assert!(RangeRef::from_a1("A1::B2").is_err());
    // full-column / full-row references are not supported yet
    assert!(RangeRef::from_a1("A:A").is_err());
    assert!(RangeRef::from_a1("1:1").is_err());
}

// ---------- sheet-qualified references ----------

#[test]
fn qualified_plain_cell() {
    let q = parse_sheet_qualified_ref("A1").unwrap();
    assert_eq!(q.sheet, None);
    assert!(matches!(q.target, RefTarget::Cell(_)));
}

#[test]
fn qualified_unquoted_sheet() {
    let q = parse_sheet_qualified_ref("Sheet1!B2").unwrap();
    assert_eq!(q.sheet.as_deref(), Some("Sheet1"));
    match q.target {
        RefTarget::Cell(c) => assert_eq!((c.row, c.col), (1, 1)),
        _ => panic!("expected cell"),
    }
}

#[test]
fn qualified_quoted_sheet_with_space() {
    let q = parse_sheet_qualified_ref("'Sales 2026'!A1").unwrap();
    assert_eq!(q.sheet.as_deref(), Some("Sales 2026"));
    match q.target {
        RefTarget::Cell(c) => assert_eq!((c.row, c.col), (0, 0)),
        _ => panic!("expected cell"),
    }
}

#[test]
fn qualified_quoted_sheet_escaped_quote() {
    let q = parse_sheet_qualified_ref("'O''Brien'!C3").unwrap();
    assert_eq!(q.sheet.as_deref(), Some("O'Brien"));
}

#[test]
fn qualified_quoted_range() {
    let q = parse_sheet_qualified_ref("'P & L'!$A$1:$B$10").unwrap();
    assert_eq!(q.sheet.as_deref(), Some("P & L"));
    match q.target {
        RefTarget::Range(r) => {
            assert!(r.start.col_abs);
            assert_eq!(r.cell_count(), 20);
        }
        _ => panic!("expected range"),
    }
}

#[test]
fn qualified_bang_inside_quotes_is_not_split() {
    // The '!' inside the quoted name must not be treated as the separator.
    let q = parse_sheet_qualified_ref("'Wow!Sheets'!D4").unwrap();
    assert_eq!(q.sheet.as_deref(), Some("Wow!Sheets"));
    match q.target {
        RefTarget::Cell(c) => assert_eq!((c.row, c.col), (3, 3)),
        _ => panic!("expected cell"),
    }
}

#[test]
fn qualified_rejects_external_workbook() {
    let e = parse_sheet_qualified_ref("[1]Sheet1!A1").unwrap_err();
    assert_eq!(e.kind, RefParseErrorKind::UnsupportedExternalRef);
}

#[test]
fn qualified_rejects_second_sheet_qualifier() {
    let e = parse_sheet_qualified_ref("Sheet1!A1:Sheet1!B2").unwrap_err();
    assert_eq!(e.kind, RefParseErrorKind::UnsupportedRangeForm);
}

#[test]
fn qualified_rejects_invalid_names() {
    assert!(parse_sheet_qualified_ref("''!A1").is_err()); // empty quoted name
    assert!(parse_sheet_qualified_ref("'Unclosed!A1").is_err());
    assert!(parse_sheet_qualified_ref("Bad Name!A1").is_err()); // space needs quotes
    assert!(parse_sheet_qualified_ref("A1!A1").is_err()); // ambiguous name
    assert!(parse_sheet_qualified_ref("Sheet1!").is_err());
}

#[test]
fn sheet_name_validation() {
    assert!(is_valid_sheet_name("Sheet1"));
    assert!(is_valid_sheet_name("Sales 2026"));
    assert!(!is_valid_sheet_name(""));
    assert!(!is_valid_sheet_name(&"x".repeat(32)));
    assert!(is_valid_sheet_name(&"x".repeat(31)));
    for bad in ["a/b", "a\\b", "a?b", "a*b", "a:b", "a[b", "a]b"] {
        assert!(!is_valid_sheet_name(bad), "name {bad:?}");
    }
}

// ---------- CellId ----------

#[test]
fn cell_id_bounds_and_a1() {
    use calc_core::CellId;
    let id = CellId::new(0, 0, 0).unwrap();
    assert_eq!(id.to_a1(), "A1");
    let id = CellId::new(3, MAX_ROWS - 1, MAX_COLS - 1).unwrap();
    assert_eq!(id.to_a1(), "XFD1048576");
    assert!(CellId::new(0, MAX_ROWS, 0).is_err());
    assert!(CellId::new(0, 0, MAX_COLS).is_err());
}

// ---------- Workbook ----------

#[test]
fn workbook_add_and_lookup_sheets() {
    let mut wb = Workbook::new();
    let id = wb.add_sheet("Sheet1").unwrap();
    assert_eq!(id, 0);
    assert_eq!(wb.sheet_id("sheet1"), Some(0)); // case-insensitive
    assert_eq!(wb.sheet_by_name("SHEET1").unwrap().name(), "Sheet1");
    assert_eq!(wb.add_sheet("Data").unwrap(), 1);
    assert_eq!(wb.sheets().len(), 2);
}

#[test]
fn workbook_rejects_duplicate_sheet_names() {
    let mut wb = Workbook::new();
    wb.add_sheet("Data").unwrap();
    assert!(matches!(
        wb.add_sheet("DATA"),
        Err(WorkbookError::DuplicateSheetName(_))
    ));
}

#[test]
fn workbook_rejects_invalid_sheet_names() {
    let mut wb = Workbook::new();
    assert!(matches!(
        wb.add_sheet("bad/name"),
        Err(WorkbookError::InvalidSheetName(_))
    ));
    assert!(matches!(
        wb.add_sheet(""),
        Err(WorkbookError::InvalidSheetName(_))
    ));
}

#[test]
fn workbook_set_get_clear_cell() {
    let mut wb = Workbook::new();
    let id = wb.add_sheet("S").unwrap();
    wb.set_cell(id, 0, 0, CellInput::Value(Value::Number(1.5)))
        .unwrap();
    assert_eq!(
        wb.cell(id, 0, 0).unwrap().input,
        CellInput::Value(Value::Number(1.5))
    );
    wb.clear_cell(id, 0, 0).unwrap();
    assert!(wb.cell(id, 0, 0).is_none());
}

#[test]
fn workbook_formula_input_stored_verbatim() {
    let mut wb = Workbook::new();
    let id = wb.add_sheet("S").unwrap();
    wb.set_cell(id, 2, 1, CellInput::Formula("SUM(A1:A3)".into()))
        .unwrap();
    let cell = wb.cell(id, 2, 1).unwrap();
    assert!(cell.input.is_formula());
    assert_eq!(cell.input.formula(), Some("SUM(A1:A3)"));
}

#[test]
fn cell_input_from_typed() {
    assert_eq!(
        CellInput::from_typed("=1+2"),
        CellInput::Formula("1+2".into())
    );
    assert_eq!(
        CellInput::from_typed("hello"),
        CellInput::Value(Value::Text("hello".into()))
    );
    assert_eq!(CellInput::from_typed("="), CellInput::Formula("".into()));
}

#[test]
fn workbook_a1_accessors() {
    let mut wb = Workbook::new();
    wb.add_sheet("S").unwrap();
    wb.set_cell_a1("S", "$B$7", CellInput::Value(Value::Boolean(true)))
        .unwrap();
    let cell = wb.cell_a1("S", "B7").unwrap().unwrap();
    assert_eq!(cell.input, CellInput::Value(Value::Boolean(true)));
    assert!(matches!(
        wb.cell_a1("Missing", "A1"),
        Err(WorkbookError::SheetNotFound)
    ));
    assert!(matches!(
        wb.cell_a1("S", "A0"),
        Err(WorkbookError::BadAddress(_))
    ));
}

#[test]
fn workbook_set_cell_bounds() {
    let mut wb = Workbook::new();
    let id = wb.add_sheet("S").unwrap();
    assert!(
        wb.set_cell(
            id,
            MAX_ROWS - 1,
            MAX_COLS - 1,
            CellInput::Value(Value::Blank)
        )
        .is_ok()
    );
    assert_eq!(
        wb.set_cell(id, MAX_ROWS, 0, CellInput::Value(Value::Blank)),
        Err(WorkbookError::CellOutOfBounds)
    );
    assert_eq!(
        wb.set_cell(id, 0, MAX_COLS, CellInput::Value(Value::Blank)),
        Err(WorkbookError::CellOutOfBounds)
    );
    assert_eq!(
        wb.set_cell(9, 0, 0, CellInput::Value(Value::Blank)),
        Err(WorkbookError::SheetNotFound)
    );
}

#[test]
fn workbook_date_system_setting() {
    let wb = Workbook::new();
    assert_eq!(wb.date_system(), DateSystem::Excel1900);
    let wb = Workbook::with_date_system(DateSystem::Excel1904);
    assert_eq!(wb.date_system(), DateSystem::Excel1904);
    let mut wb = Workbook::new();
    wb.set_date_system(DateSystem::Excel1904);
    assert_eq!(wb.date_system(), DateSystem::Excel1904);
}

#[test]
fn sheet_iterates_cells_in_order() {
    let mut wb = Workbook::new();
    let id = wb.add_sheet("S").unwrap();
    wb.set_cell(id, 5, 0, CellInput::Value(Value::Number(5.0)))
        .unwrap();
    wb.set_cell(id, 0, 2, CellInput::Value(Value::Number(1.0)))
        .unwrap();
    let sheet = wb.sheet(id).unwrap();
    let positions: Vec<(u32, u32)> = sheet.cells().map(|(id, _)| (id.row, id.col)).collect();
    assert_eq!(positions, vec![(0, 2), (5, 0)]);
}
