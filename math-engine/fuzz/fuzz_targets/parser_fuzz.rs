#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Feed arbitrary bytes to the parser as UTF-8 (lossy conversion keeps
    // invalid byte sequences in play instead of skipping them). Any
    // `Result` from `parse` is acceptable — Ok or Err — as long as the
    // parser does not panic, loop forever, or expand the input
    // exponentially. The parser enforces its own input limits
    // (docs/IMPLEMENTATION_PLAN.md section 10.4: MAX_FORMULA_LEN 64 KiB,
    // MAX_TOKENS, MAX_AST_NODES, MAX_DEPTH); the target intentionally adds
    // no workarounds so limit bugs surface as crashes.
    let src = String::from_utf8_lossy(data);
    let _ = calc_core::parse(&src);
});
