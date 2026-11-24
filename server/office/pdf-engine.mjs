// Generated from vendored @devmoter/pdf sources. See vendor/pdf/NOTICE.md.

// vendor/pdf/src/extract.ts
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
var standardFontDataUrl = join(
  dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
  "standard_fonts"
) + "/";
var Y_TOLERANCE_RATIO = 0.5;
function joinItems(items) {
  let text = "";
  let lastY;
  let lastH = 0;
  for (const it of items) {
    if (it.str.length === 0) continue;
    const tol = Math.max(lastH, it.height) * Y_TOLERANCE_RATIO;
    if (lastY === void 0) {
      text += it.str;
    } else if (Math.abs(it.y - lastY) <= tol) {
      text += (text.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str;
    } else {
      text += "\n" + it.str;
    }
    lastY = it.y;
    lastH = it.height;
  }
  return text;
}
async function extractText(data) {
  const doc = await getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl,
    // Avoids requiring system font/canvas packages under Node.
    disableFontFace: true
  }).promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info ?? {};
    const metadata = info.Title !== void 0 || info.Author !== void 0 ? { title: info.Title, author: info.Author } : void 0;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const it = raw;
        const x = it.transform[4];
        const y = it.transform[5];
        items.push({
          str: it.str,
          x,
          y,
          width: it.width,
          height: it.height,
          fontName: it.fontName
        });
      }
      pages.push({ page: p, text: joinItems(items), items });
    }
    return { pageCount: doc.numPages, metadata, pages };
  } finally {
    await doc.destroy();
  }
}

// vendor/pdf/src/pages.ts
import { degrees } from "pdf-lib";

// vendor/pdf/src/internal/io.ts
import { PDFDocument } from "pdf-lib";
async function loadPdf(data) {
  return PDFDocument.load(data);
}
async function createPdf() {
  return PDFDocument.create();
}
async function savePdf(doc) {
  return doc.save();
}

// vendor/pdf/src/pages.ts
function assertNonEmpty(data, what = "input PDF") {
  if (!data || data.length === 0) {
    throw new Error(`${what} is empty`);
  }
}
function assertPageIndex(page, pageCount) {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new Error(
      `Page number ${page} is out of range (document has ${pageCount} page(s))`
    );
  }
}
function assertUnique(pages) {
  const seen = /* @__PURE__ */ new Set();
  for (const p of pages) {
    if (seen.has(p)) {
      throw new Error(`Duplicate page number ${p} in page list`);
    }
    seen.add(p);
  }
}
async function extractPages(data, pages) {
  assertNonEmpty(data);
  if (!pages || pages.length === 0) {
    throw new Error("extractPages requires a non-empty page list");
  }
  const src = await loadPdf(data);
  const pageCount = src.getPageCount();
  for (const p of pages) assertPageIndex(p, pageCount);
  assertUnique(pages);
  const out = await createPdf();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return savePdf(out);
}
async function rotatePages(data, pages, degrees_) {
  assertNonEmpty(data);
  if (degrees_ !== 90 && degrees_ !== 180 && degrees_ !== 270) {
    throw new Error(`Rotation must be 90, 180 or 270 degrees, got ${degrees_}`);
  }
  const doc = await loadPdf(data);
  const pageCount = doc.getPageCount();
  const targets = pages === "all" ? range1(pageCount) : pages;
  if (targets.length === 0) {
    throw new Error("rotatePages requires a non-empty page list");
  }
  assertUnique(targets);
  for (const p of targets) {
    assertPageIndex(p, pageCount);
    const page = doc.getPage(p - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + degrees_) % 360));
  }
  return savePdf(doc);
}
async function reorderPages(data, order) {
  assertNonEmpty(data);
  const src = await loadPdf(data);
  const pageCount = src.getPageCount();
  if (!order || order.length !== pageCount) {
    throw new Error(
      `order must contain exactly ${pageCount} entries (a permutation of 1..${pageCount})`
    );
  }
  const sorted = [...order].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      throw new Error(
        `order is not a valid permutation of 1..${pageCount} (got [${order.join(", ")}])`
      );
    }
  }
  const out = await createPdf();
  const copied = await out.copyPages(src, order.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return savePdf(out);
}
async function deletePages(data, pages) {
  assertNonEmpty(data);
  if (!pages || pages.length === 0) {
    throw new Error("deletePages requires a non-empty page list");
  }
  const doc = await loadPdf(data);
  const pageCount = doc.getPageCount();
  assertUnique(pages);
  for (const p of pages) assertPageIndex(p, pageCount);
  for (const p of [...pages].sort((a, b) => b - a)) {
    doc.removePage(p - 1);
  }
  return savePdf(doc);
}
async function getPageInfo(data) {
  assertNonEmpty(data);
  const doc = await loadPdf(data);
  const pages = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height, rotation: page.getRotation().angle };
  });
  return { pageCount: doc.getPageCount(), pages };
}
function range1(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

// vendor/pdf/src/forms.ts
import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField
} from "pdf-lib";
function assertNoXfa(doc) {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm?.has(PDFName.of("XFA"))) {
    throw new Error(
      "XFA forms are not supported by pdf-lib (listFields/fillForm only handle AcroForm documents)."
    );
  }
}
function fieldType(field) {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFOptionList) return "optionList";
  if (field instanceof PDFButton) return "button";
  if (field instanceof PDFSignature) return "signature";
  throw new Error(`Unsupported field class: ${field.constructor.name}`);
}
function fieldValue(field) {
  if (field instanceof PDFTextField) return field.getText() ?? "";
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFDropdown) return field.getSelected();
  if (field instanceof PDFRadioGroup) return field.getSelected();
  if (field instanceof PDFOptionList) return field.getSelected();
  return void 0;
}
function fieldOptions(field) {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
    return field.getOptions();
  }
  return void 0;
}
async function listFields(data) {
  const doc = await loadPdf(data);
  assertNoXfa(doc);
  return doc.getForm().getFields().map((f) => ({
    name: f.getName(),
    type: fieldType(f),
    value: fieldValue(f),
    options: fieldOptions(f),
    readOnly: f.isReadOnly(),
    required: f.isRequired()
  }));
}
function describeValidFields(fields) {
  return fields.map((f) => `${f.getName()} (${fieldType(f)})`).join(", ");
}
async function fillForm(data, values, opts) {
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
        `Unknown form field "${name}". Valid fields: ${valid() || "(none)"}`
      );
    }
    const typeErr = (expected) => new Error(
      `Invalid value type for field "${name}" (${fieldType(field)}): expected ${expected}, got ${Array.isArray(value) ? "string[]" : typeof value}. Valid fields: ${valid()}`
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
        `Field "${name}" of type "${fieldType(field)}" cannot be filled. Valid fields: ${valid()}`
      );
    }
  }
  if (opts?.flatten) form.flatten();
  return doc.save();
}

// vendor/pdf/src/draw.ts
import fontkit from "@pdf-lib/fontkit";
import {
  degrees as degrees2,
  rgb,
  StandardFonts
} from "pdf-lib";
var BLACK = rgb(0, 0, 0);
function getPageAt(doc, page) {
  const pages = doc.getPages();
  if (page < 0 || page >= pages.length) {
    throw new RangeError(
      `Page index ${page} out of range (document has ${pages.length} pages)`
    );
  }
  return pages[page];
}
async function stampText(data, opts) {
  const doc = await loadPdf(data);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = opts.position === "diagonal" ? 60 : 14;
  const opacity = opts.opacity ?? 0.5;
  const targets = opts.pages === void 0 || opts.pages === "all" ? doc.getPages() : opts.pages.map((i) => getPageAt(doc, i));
  for (const p of targets) {
    const { width, height } = p.getSize();
    if (opts.position === "diagonal") {
      const tw = font.widthOfTextAtSize(opts.text, size);
      p.drawText(opts.text, {
        x: width / 2 - tw / 2,
        y: height / 2,
        size,
        font,
        color: rgb(0.8, 0.1, 0.1),
        opacity,
        rotate: degrees2(45)
      });
    } else {
      const tw = font.widthOfTextAtSize(opts.text, size);
      p.drawText(opts.text, {
        x: width / 2 - tw / 2,
        y: opts.position === "header" ? height - 40 : 30,
        size,
        font,
        color: rgb(0.8, 0.1, 0.1),
        opacity
      });
    }
  }
  return doc.save();
}
async function createDocument(opts) {
  if (!opts.pages.length || opts.pages.some((lines) => !lines.length))
    throw new Error("createDocument requires at least one line per page");
  const doc = await createPdf();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (opts.title !== void 0) doc.setTitle(opts.title);
  doc.setCreator(opts.creator ?? "DevMoter Office");
  doc.setProducer("DevMoter Office");
  for (const lines of opts.pages) {
    const page = doc.addPage([612, 792]);
    let y = 792 - 72;
    for (const line of lines) {
      const size = line.size ?? 11;
      y -= size * 1.4;
      if (y < 72) break;
      page.drawText(line.text, {
        x: 72,
        y,
        size,
        font: size >= 14 ? bold : font
      });
    }
  }
  return savePdf(doc);
}
async function getMetadata(data) {
  const doc = await loadPdf(data);
  return {
    title: doc.getTitle() || void 0,
    author: doc.getAuthor() || void 0,
    subject: doc.getSubject() || void 0,
    keywords: doc.getKeywords()?.split(/\s+/).filter(Boolean),
    creator: doc.getCreator() || void 0
  };
}
async function setMetadata(data, meta) {
  const doc = await loadPdf(data);
  if (meta.title !== void 0) doc.setTitle(meta.title);
  if (meta.author !== void 0) doc.setAuthor(meta.author);
  if (meta.subject !== void 0) doc.setSubject(meta.subject);
  if (meta.keywords !== void 0) doc.setKeywords(meta.keywords);
  if (meta.creator !== void 0) doc.setCreator(meta.creator);
  return doc.save();
}
export {
  createDocument,
  deletePages,
  extractPages,
  extractText,
  fillForm,
  getMetadata,
  getPageInfo,
  listFields,
  reorderPages,
  rotatePages,
  setMetadata,
  stampText
};
