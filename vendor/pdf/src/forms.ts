/**
 * AcroForm support built on pdf-lib.
 *
 * NOTE: XFA forms are NOT supported by pdf-lib (see pdf-lib docs — it can only
 * read/write classic AcroForm fields). If a document contains an XFA form, we
 * detect it explicitly and throw a descriptive error instead of silently
 * dropping the form data on save.
 */
import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFField,
  type PDFPage,
} from "pdf-lib";
import { loadPdf } from "./internal/io.js";

export type FieldType =
  | "text"
  | "checkbox"
  | "dropdown"
  | "radio"
  | "optionList"
  | "button"
  | "signature";

export interface FieldInfo {
  name: string;
  type: FieldType;
  value?: string | boolean | string[];
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldSpec {
  /** Zero-based page index. */
  page: number;
  name: string;
  rect: Rect;
}

export interface DropdownSpec extends FieldSpec {
  options: string[];
}

/**
 * pdf-lib cannot read or write XFA forms; saving a doc with one would
 * silently strip the form. Detect the AcroForm/XFA entry up front.
 */
function assertNoXfa(doc: PDFDocument): void {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm?.has(PDFName.of("XFA"))) {
    throw new Error(
      "XFA forms are not supported by pdf-lib (listFields/fillForm only handle AcroForm documents).",
    );
  }
}

function fieldType(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFOptionList) return "optionList";
  if (field instanceof PDFButton) return "button";
  if (field instanceof PDFSignature) return "signature";
  throw new Error(`Unsupported field class: ${field.constructor.name}`);
}

function fieldValue(field: PDFField): string | boolean | string[] | undefined {
  if (field instanceof PDFTextField) return field.getText() ?? "";
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFDropdown) return field.getSelected();
  if (field instanceof PDFRadioGroup) return field.getSelected();
  if (field instanceof PDFOptionList) return field.getSelected();
  return undefined; // buttons and signatures carry no fillable value
}

function fieldOptions(field: PDFField): string[] | undefined {
  if (
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList ||
    field instanceof PDFRadioGroup
  ) {
    return field.getOptions();
  }
  return undefined;
}

/** List all AcroForm fields in a PDF. */
export async function listFields(data: Uint8Array): Promise<FieldInfo[]> {
  const doc = await loadPdf(data);
  assertNoXfa(doc);
  return doc
    .getForm()
    .getFields()
    .map((f) => ({
      name: f.getName(),
      type: fieldType(f),
      value: fieldValue(f),
      options: fieldOptions(f),
      readOnly: f.isReadOnly(),
      required: f.isRequired(),
    }));
}

function describeValidFields(fields: PDFField[]): string {
  return fields.map((f) => `${f.getName()} (${fieldType(f)})`).join(", ");
}

/**
 * Fill AcroForm fields by name and return the updated PDF bytes.
 *
 * Value types per field type:
 *   text: string | checkbox: boolean | dropdown/radio: string (must be one of
 *   the field's options) | optionList: string or string[].
 * Unknown names or mismatched value types throw an error listing valid fields.
 */
export async function fillForm(
  data: Uint8Array,
  values: Record<string, string | boolean | string[]>,
  opts?: { flatten?: boolean },
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  assertNoXfa(doc);
  const form = doc.getForm();
  const fields = form.getFields();
  const byName = new Map(fields.map((f) => [f.getName(), f]));
  const valid = () => describeValidFields(fields);

  for (const [name, value] of Object.entries(values)) {
    const field = byName.get(name);
    if (!field) {
      throw new Error(
        `Unknown form field "${name}". Valid fields: ${valid() || "(none)"}`,
      );
    }
    const typeErr = (expected: string) =>
      new Error(
        `Invalid value type for field "${name}" (${fieldType(field)}): expected ${expected}, got ${
          Array.isArray(value) ? "string[]" : typeof value
        }. Valid fields: ${valid()}`,
      );

    if (field instanceof PDFTextField) {
      if (typeof value !== "string") throw typeErr("string");
      field.setText(value);
    } else if (field instanceof PDFCheckBox) {
      if (typeof value !== "boolean") throw typeErr("boolean");
      value ? field.check() : field.uncheck();
    } else if (field instanceof PDFDropdown) {
      if (typeof value !== "string") throw typeErr("string");
      field.select(value);
    } else if (field instanceof PDFRadioGroup) {
      if (typeof value !== "string") throw typeErr("string");
      field.select(value);
    } else if (field instanceof PDFOptionList) {
      if (typeof value !== "string" && !Array.isArray(value)) {
        throw typeErr("string or string[]");
      }
      field.select(value);
    } else {
      throw new Error(
        `Field "${name}" of type "${fieldType(field)}" cannot be filled. Valid fields: ${valid()}`,
      );
    }
  }

  if (opts?.flatten) form.flatten();
  return doc.save();
}

function getPageOrThrow(doc: PDFDocument, index: number): PDFPage {
  const pages = doc.getPages();
  if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
    throw new Error(
      `Page index ${index} out of range; document has ${pages.length} page(s).`,
    );
  }
  return pages[index];
}

/** Add a text field to an existing PDF. */
export async function addTextField(
  data: Uint8Array,
  spec: FieldSpec,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  assertNoXfa(doc);
  doc.getForm().createTextField(spec.name).addToPage(getPageOrThrow(doc, spec.page), spec.rect);
  return doc.save();
}

/** Add a checkbox to an existing PDF. */
export async function addCheckbox(
  data: Uint8Array,
  spec: FieldSpec,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  assertNoXfa(doc);
  doc.getForm().createCheckBox(spec.name).addToPage(getPageOrThrow(doc, spec.page), spec.rect);
  return doc.save();
}

/** Add a dropdown (combo box) with the given options to an existing PDF. */
export async function addDropdown(
  data: Uint8Array,
  spec: DropdownSpec,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  assertNoXfa(doc);
  const dropdown = doc.getForm().createDropdown(spec.name);
  dropdown.setOptions(spec.options);
  dropdown.addToPage(getPageOrThrow(doc, spec.page), spec.rect);
  return doc.save();
}
