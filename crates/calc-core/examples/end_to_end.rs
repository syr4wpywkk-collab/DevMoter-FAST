//! End-to-end example (v2 PR15): one workbook exercising a dynamic-array
//! spill (`SEQUENCE`), `LAMBDA` through `MAP`, and a lookup (`XLOOKUP`),
//! plus differential recalculation of a downstream cell.
//!
//! Run:  `cargo run -p calc-core --example end_to_end`
//!
//! Expected output (deterministic — no clock/RNG involved):
//!
//! ```text
//! ids spilled from C1: 101 102 103 104
//! squares via MAP/LAMBDA (F1): 10201 10404 10609 10816
//! price of id 103 (XLOOKUP): 30
//! discounted price (depends on lookup): 27
//! after restock (price 103 -> 35): discount = 31.5
//! ```

use calc_core::{CalcEngine, CellInput, Value};

fn main() {
    let mut e = CalcEngine::new();
    e.set_registry(Box::new(calc_functions::default_registry()));
    e.add_sheet("Sheet1").unwrap();

    let set = |e: &mut CalcEngine, addr: &str, input: &str| {
        e.set_cell("Sheet1", addr, CellInput::from_typed(input))
            .unwrap();
    };
    let set_num = |e: &mut CalcEngine, addr: &str, n: f64| {
        e.set_cell("Sheet1", addr, CellInput::Value(Value::Number(n)))
            .unwrap();
    };
    let get = |e: &mut CalcEngine, addr: &str| e.get_value("Sheet1", addr).unwrap();

    // Product price table: id -> price.
    for (i, price) in [10.0, 20.0, 30.0, 40.0].iter().enumerate() {
        let row = i + 1;
        set(&mut e, &format!("A{row}"), &format!("={}", 101 + i as u32));
        set_num(&mut e, &format!("B{row}"), *price);
    }

    // Spill: SEQUENCE writes C1:C4 as a side effect of one anchor formula.
    set(&mut e, "C1", "=SEQUENCE(4,1,101)");

    // LAMBDA: MAP squares each spilled id.
    set(&mut e, "F1", "=MAP(C1:C4,LAMBDA(x,x*x))");

    // Lookup + dependent formula.
    set(&mut e, "H1", "=XLOOKUP(103,A1:A4,B1:B4)");
    set(&mut e, "H2", "=H1*0.9"); // 10% discount

    e.recalculate().unwrap();
    assert_eq!(get(&mut e, "H1"), Value::Number(30.0));
    assert_eq!(get(&mut e, "H2"), Value::Number(27.0));
    println!(
        "ids spilled from C1: {} {} {} {}",
        get(&mut e, "C1"),
        get(&mut e, "C2"),
        get(&mut e, "C3"),
        get(&mut e, "C4")
    );
    println!(
        "squares via MAP/LAMBDA (F1): {} {} {} {}",
        get(&mut e, "F1"),
        get(&mut e, "F2"),
        get(&mut e, "F3"),
        get(&mut e, "F4")
    );
    println!("price of id 103 (XLOOKUP): {}", get(&mut e, "H1"));
    println!(
        "discounted price (depends on lookup): {}",
        get(&mut e, "H2")
    );

    // Differential recalc: changing B3 re-evaluates only H1 and H2.
    set_num(&mut e, "B3", 35.0);
    let report = e.recalculate().unwrap();
    let mut touched: Vec<String> = report.evaluated.iter().map(|c| c.to_a1()).collect();
    touched.sort_unstable();
    assert_eq!(touched, ["H1", "H2"]);
    assert_eq!(get(&mut e, "H1"), Value::Number(35.0));
    assert_eq!(get(&mut e, "H2"), Value::Number(31.5));
    println!(
        "after restock (price 103 -> 35): discount = {}",
        get(&mut e, "H2")
    );
}
