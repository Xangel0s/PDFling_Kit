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
  shapePlacements: ShapePlacement[];
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

export interface ShapePlacement {
  pageIndex: number;
  kind: "rect" | "ellipse" | "triangle";
  x: number;
  y: number;
  width: number;
  height: number;
  colorHex: string;
  rounded?: boolean;
  cornerRadius?: number;
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  if (r <= 0.01) {
    return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
  }

  return [
    `M ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `L ${x + r} ${y + height}`,
    `Q ${x} ${y + height} ${x} ${y + height - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    "Z"
  ].join(" ");
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

    for (const shapeItem of input.shapePlacements) {
      const page = pdfDoc.getPage(shapeItem.pageIndex);
      const pageHeight = page.getHeight();
      const pdfX = shapeItem.x / input.renderScale;
      const pdfWidth = Math.max(1, shapeItem.width / input.renderScale);
      const pdfHeight = Math.max(1, shapeItem.height / input.renderScale);
      const pdfY = pageHeight - (shapeItem.y / input.renderScale) - pdfHeight;
      const colorRgb = hexToRgb(shapeItem.colorHex);
      const fill = rgb(colorRgb.r, colorRgb.g, colorRgb.b);

      if (shapeItem.kind === "ellipse") {
        page.drawEllipse({
          x: pdfX + (pdfWidth / 2),
          y: pdfY + (pdfHeight / 2),
          xScale: pdfWidth / 2,
          yScale: pdfHeight / 2,
          color: fill
        });
        continue;
      }

      if (shapeItem.kind === "triangle") {
        const topX = pdfX + (pdfWidth / 2);
        const topY = pdfY + pdfHeight;
        const rightX = pdfX + pdfWidth;
        const rightY = pdfY;
        const leftX = pdfX;
        const leftY = pdfY;
        page.drawSvgPath(`M ${topX} ${topY} L ${rightX} ${rightY} L ${leftX} ${leftY} Z`, {
          color: fill
        });
        continue;
      }

      if (shapeItem.rounded) {
        const radius = Math.max(2, (shapeItem.cornerRadius ?? 10) / input.renderScale);
        page.drawSvgPath(roundedRectPath(pdfX, pdfY, pdfWidth, pdfHeight, radius), {
          color: fill
        });
        continue;
      }

      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
        color: fill
      });
    }

    const resultBytes = await pdfDoc.save();
    const normalizedBytes = new Uint8Array(resultBytes);
    return new Blob([normalizedBytes], { type: "application/pdf" });
  }
}
