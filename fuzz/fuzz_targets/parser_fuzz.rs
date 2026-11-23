#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // TODO(PR-02): once `calc_core::parse` exists, replace this pass-through
    // target with:
    //     if let Ok(s) = std::str::from_utf8(data) {
    //         let _ = calc_core::parse(s);
    //     }
    // The parser must enforce the input limits from
    // docs/IMPLEMENTATION_PLAN.md section 10.4 (64 KiB formula length,
    // 10,000 AST nodes, recursion depth 256) and must never panic, loop
    // forever, or expand input exponentially.
    //
    // For now we only constrain input size so early corpus entries already
    // reflect the intended length budget.
    if data.len() <= 64 * 1024 {
        let _ = data;
    }
});
