/**
 * Usage example for the calc-wasm bindings.
 *
 * After building the crate (`wasm-pack build crates/calc-wasm`), import
 * the generated module; the declarations in `calc-wasm.d.ts` describe
 * the API below.
 */
import init, {
  WasmWorkbook,
  functionNames,
  type CellValue,
} from "calc-wasm";

async function main(): Promise<void> {
  await init(); // load + instantiate the .wasm module

  const wb = new WasmWorkbook(); // one sheet: "Sheet1"

  // Typed literals via setCellValue; formulas via setCell with '='.
  wb.setCellValue("Sheet1", "A1", 6);
  wb.setCellValue("Sheet1", "A2", 7);
  wb.setCell("Sheet1", "A3", "=SUM(A1:A2)");
  wb.setCell("Sheet1", "B1", "=1/0");

  const report = wb.recalculate();
  console.log(`evaluated ${report.evaluated.length} cells in ${report.steps} steps`);

  const total: CellValue = wb.getValue("Sheet1", "A3");
  if (total.kind === "number") {
    console.log(`A3 = ${total.value}`); // 13
  }

  const err = wb.getValue("Sheet1", "B1");
  if (err.kind === "error") {
    console.log(`B1 is ${err.code}`); // "#DIV/0!"
  }

  // Scratch evaluation without storing anything.
  console.log(wb.evalFormula("Sheet1", "=A1*A2")); // { kind: "number", value: 42 }

  console.log(`${functionNames().length} functions registered`);
  wb.free();
}

main();
