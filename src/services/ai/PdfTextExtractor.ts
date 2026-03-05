import { PdfRenderer } from "../../workspace/render/PdfRenderer";

export class PdfTextExtractor {
  async extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
    const renderer = new PdfRenderer();
    await renderer.loadDocument(arrayBuffer);
    return renderer.extractAllText();
  }
}
