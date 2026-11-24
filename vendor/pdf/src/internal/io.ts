import { PDFDocument } from "pdf-lib";

/** Load an existing PDF; shared by all manipulation modules. */
export async function loadPdf(data: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(data);
}

/** Create an empty PDF document. */
export async function createPdf(): Promise<PDFDocument> {
  return PDFDocument.create();
}

/** Serialize a document to bytes. */
export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}
