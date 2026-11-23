# HLOOKUP

`HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])` —
horizontal variant of `VLOOKUP`: searches the first row, returns from
`row_index_num`.

v2 plan §2 (050): horizontal equivalent of VLOOKUP; row index and
approximate match.

## Arguments & behavior
- Identical to `VLOOKUP` with rows/columns transposed:
  - first *row* of `table_array` is searched;
  - `row_index_num` selects the result row (1-based, truncated);
  - `range_lookup` default TRUE = approximate, assumes first row sorted
    ascending; FALSE = exact match with wildcard/case rules as VLOOKUP.

## Errors
- No match -> `#N/A`.
- `row_index_num` < 1 -> `#VALUE!`; > table height -> `#REF!`.
- Error `lookup_value` propagates; error cells in the scanned row —
  same open question as VLOOKUP.

## Edge cases
- Single-column `table_array` is legal.
- Approximate mode with lookup below all keys -> `#N/A`.

## Open questions
- Shares every open question listed in `VLOOKUP.md`; resolved together
  in `common/lookup.rs` so both functions stay consistent.
