# BAHTTEXT

`BAHTTEXT(number)` — converts a number to Thai text expressing the
amount in Thai baht currency, followed by the `บาทถ้วน` suffix.

## Arguments
- `number`: required; coerced to number (numeric text -> number,
  boolean -> 1/0, blank -> 0, error propagates). Non-coercible text
  -> `#VALUE!`.

## Semantics
- The integer part is spelled out in Thai number words; the fractional
  part (rounded to 2 decimals) is spelled out as satang. When the
  satang amount is 0, `ถ้วน` (exact) is appended after `บาท`; nonzero
  satang produces `Nสตางค์`.
- Rounding to satang uses Excel's display rounding (half away from
  zero — confirm).
- Negative numbers: Excel behavior is **SPEC-OPEN** (reported
  behaviors include wrapping in parentheses text or producing
  `ลบ`-prefixed output; verify against reference before fixing).

## Engine requirements
- A Thai number-word generation table must ship with the engine
  (std only). This is deterministic but linguistically verbose;
  fixtures must come from a recorded reference output, not from
  ad-hoc transliteration.

## Errors
- `#VALUE!` for non-coercible `number`.
- `#NUM!` is not documented for any input range — confirm behavior on
  huge magnitudes (overflow of the Thai place-value table).

## Examples (recorded expectations; verify against reference)
- `BAHTTEXT(1234)` -> Thai text of one-thousand-two-hundred-thirty-four
  baht exact (`"หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน"`).
- `BAHTTEXT(0)` -> `"ศูนย์บาทถ้วน"`.
- `BAHTTEXT(0.5)` -> satang-only output (`"ห้าสิบสตางค์"` — confirm
  whether `บาท` appears when integer part is 0).
- `BAHTTEXT(-1)` -> **SPEC-OPEN**.

## Compatibility
- Available in all Excel versions regardless of UI locale (output is
  always Thai). LibreOffice implements a compatible `BAHTTEXT`.

## Open questions
- Negative number handling.
- Zero-integer-part-with-satang phrasing.
- Satang rounding rule and behavior for numbers > 2 decimals
  (e.g. `BAHTTEXT(1.005)`).
- Large-magnitude overflow behavior.
