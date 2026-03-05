import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");

export interface RenderResult {
  width: number;
  height: number;
  scale: number;
  pageCount: number;
}

export class PdfRenderer {
  private pdfDoc: any = null;

  async loadDocument(arrayBuffer: ArrayBuffer, password?: string): Promise<number> {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password });
    this.pdfDoc = await loadingTask.promise;
    return this.pdfDoc.numPages as number;
  }

  async renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale = 1.25): Promise<RenderResult> {
    if (!this.pdfDoc) {
      throw new Error("No hay un documento cargado.");
    }

    const page = await this.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No fue posible obtener el contexto de canvas.");
    }

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    return {
      width: canvas.width,
      height: canvas.height,
      scale,
      pageCount: this.pdfDoc.numPages as number
    };
  }

  async extractAllText(): Promise<string> {
    if (!this.pdfDoc) {
      throw new Error("No hay un documento cargado para extraer texto.");
    }

    const chunks: string[] = [];
    for (let i = 1; i <= this.pdfDoc.numPages; i += 1) {
      const page = await this.pdfDoc.getPage(i);
      const text = await page.getTextContent();
      const pageText = text.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");
      chunks.push(pageText);
    }

    return chunks.join("\n\n");
  }

  async renderPageThumbnail(pageNumber: number, maxWidth = 84): Promise<string> {
    if (!this.pdfDoc) {
      throw new Error("No hay un documento cargado.");
    }

    const page = await this.pdfDoc.getPage(pageNumber);
    const viewportAtOne = page.getViewport({ scale: 1 });
    const safeWidth = Math.max(12, maxWidth);
    const scale = safeWidth / viewportAtOne.width;
    const viewport = page.getViewport({ scale });
    const thumbCanvas = document.createElement("canvas");
    const thumbCtx = thumbCanvas.getContext("2d");

    if (!thumbCtx) {
      throw new Error("No fue posible crear el contexto para miniatura.");
    }

    thumbCanvas.width = Math.floor(viewport.width);
    thumbCanvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: thumbCtx, viewport }).promise;
    return thumbCanvas.toDataURL("image/png");
  }
}
