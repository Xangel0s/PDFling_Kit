import { PDFDocument } from "pdf-lib";
import type { StampPlacement } from "../canvas/FabricOverlay";
import { StandardFonts, rgb } from "pdf-lib";

export interface StampAsset {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportDocumentInput {
  sourcePdfBuffer: ArrayBuffer;
  placements: StampPlacement[];
  stampAssets: Record<string, StampAsset>;
  textPlacements: TextPlacement[];
  renderScale: number;
}

export interface TextPlacement {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  colorHex: string;
  eraseOriginal?: boolean;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "").trim();
  const fallback = { r: 0.1, g: 0.2, b: 0.35 };
  if (normalized.length !== 6) {
    return fallback;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;

  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return fallback;
  }

  return { r, g, b };
}

export class PdfFlattenService {
  async exportDocument(input: ExportDocumentInput): Promise<Blob> {
    const pdfDoc = await PDFDocument.load(input.sourcePdfBuffer);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const embeddedCache = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();

    for (const placement of input.placements) {
      const asset = input.stampAssets[placement.stampId];
      if (!asset) {
        continue;
      }

      const page = pdfDoc.getPage(placement.pageIndex);
      const pageHeight = page.getHeight();

      let embedded = embeddedCache.get(placement.stampId);
      if (!embedded) {
        embedded = asset.mimeType === "image/jpeg"
          ? await pdfDoc.embedJpg(asset.bytes)
          : await pdfDoc.embedPng(asset.bytes);
        embeddedCache.set(placement.stampId, embedded);
      }

      const pdfX = placement.x / input.renderScale;
      const pdfWidth = placement.width / input.renderScale;
      const pdfHeight = placement.height / input.renderScale;

      // El eje Y en PDF crece hacia arriba; Fabric usa origen superior.
      const pdfY = pageHeight - (placement.y / input.renderScale) - pdfHeight;

      page.drawImage(embedded, {
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight
      });
    }

    for (const textItem of input.textPlacements) {
      const page = pdfDoc.getPage(textItem.pageIndex);
      const pageHeight = page.getHeight();
      const fontSize = Math.max(8, textItem.fontSize / input.renderScale);
      const pdfX = textItem.x / input.renderScale;
      const pdfWidth = Math.max(1, textItem.width / input.renderScale);
      const pdfHeight = Math.max(fontSize, textItem.height / input.renderScale);
      const pdfRectY = pageHeight - (textItem.y / input.renderScale) - pdfHeight;
      const pdfY = pageHeight - (textItem.y / input.renderScale) - Math.max(fontSize, textItem.height / input.renderScale);
      const rgbColor = hexToRgb(textItem.colorHex);

      if (textItem.eraseOriginal) {
        page.drawRectangle({
          x: pdfX,
          y: pdfRectY,
          width: pdfWidth,
          height: pdfHeight,
          color: rgb(1, 1, 1)
        });
      }

      page.drawText(textItem.text, {
        x: pdfX,
        y: pdfY,
        size: fontSize,
        font,
        color: rgb(rgbColor.r, rgbColor.g, rgbColor.b),
        maxWidth: pdfWidth
      });
    }

    const resultBytes = await pdfDoc.save();
    const normalizedBytes = new Uint8Array(resultBytes);
    return new Blob([normalizedBytes], { type: "application/pdf" });
  }
}
