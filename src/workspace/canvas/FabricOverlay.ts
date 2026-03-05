import { fabric } from "fabric";

export interface StampPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
  stampId: string;
}

export class FabricOverlay {
  private canvas: fabric.Canvas;

  constructor(canvasEl: HTMLCanvasElement) {
    this.canvas = new fabric.Canvas(canvasEl, {
      selection: true,
      preserveObjectStacking: true
    });

    this.canvas.on("object:moving", (event) => {
      if (event.target) {
        this.keepObjectInsideCanvas(event.target);
      }
    });

    this.canvas.on("object:scaling", (event) => {
      if (event.target) {
        this.keepObjectInsideCanvas(event.target);
      }
    });
  }

  private keepObjectInsideCanvas(target: fabric.Object): void {
    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();
    const bound = target.getBoundingRect(true, true);

    if (bound.width > canvasWidth && target.scaleX) {
      target.scaleX *= canvasWidth / bound.width;
    }

    if (bound.height > canvasHeight && target.scaleY) {
      target.scaleY *= canvasHeight / bound.height;
    }

    const nextBound = target.getBoundingRect(true, true);

    if (nextBound.left < 0) {
      target.left = (target.left ?? 0) - nextBound.left;
    }

    if (nextBound.top < 0) {
      target.top = (target.top ?? 0) - nextBound.top;
    }

    if (nextBound.left + nextBound.width > canvasWidth) {
      target.left = (target.left ?? 0) - ((nextBound.left + nextBound.width) - canvasWidth);
    }

    if (nextBound.top + nextBound.height > canvasHeight) {
      target.top = (target.top ?? 0) - ((nextBound.top + nextBound.height) - canvasHeight);
    }

    target.setCoords();
  }

  resize(width: number, height: number): void {
    this.canvas.setWidth(width);
    this.canvas.setHeight(height);
    this.canvas.requestRenderAll();
  }

  addStampImage(dataUrl: string, stampId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(
        dataUrl,
        (img) => {
          if (!img) {
            reject(new Error("No se pudo crear la imagen para el sello."));
            return;
          }

          const canvasWidth = this.canvas.getWidth();
          const canvasHeight = this.canvas.getHeight();
          const sourceWidth = img.width ?? 1;
          const sourceHeight = img.height ?? 1;
          const maxWidth = Math.max(120, canvasWidth * 0.28);
          const maxHeight = Math.max(90, canvasHeight * 0.24);
          const fitScale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
          const normalizedScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 0.35;

          const visibleWidth = sourceWidth * normalizedScale;
          const visibleHeight = sourceHeight * normalizedScale;

          img.set({
            left: Math.max(8, (canvasWidth - visibleWidth) / 2),
            top: Math.max(8, (canvasHeight - visibleHeight) / 2),
            scaleX: normalizedScale,
            scaleY: normalizedScale,
            cornerColor: "#1f4a80",
            transparentCorners: false
          });
          (img as fabric.Image & { miniStampId?: string }).miniStampId = stampId;
          (img as fabric.Image & { miniObjectType?: string }).miniObjectType = "image";

          this.canvas.add(img);
          this.keepObjectInsideCanvas(img);
          this.canvas.setActiveObject(img);
          this.canvas.requestRenderAll();
          resolve();
        },
        { crossOrigin: "anonymous" }
      );
    });
  }

  collectStampPlacements(pageIndex: number): StampPlacement[] {
    return this.canvas
      .getObjects("image")
      .map((obj) => {
        const width = (obj.width ?? 0) * (obj.scaleX ?? 1);
        const height = (obj.height ?? 0) * (obj.scaleY ?? 1);
        const stampId = (obj as fabric.Image & { miniStampId?: string }).miniStampId ?? "";
        return {
          x: obj.left ?? 0,
          y: obj.top ?? 0,
          width,
          height,
          pageIndex,
          stampId
        };
      })
      .filter((item) => item.width > 0 && item.height > 0 && Boolean(item.stampId));
  }

  addText(text: string): void {
    const textbox = new fabric.Textbox(text, {
      left: Math.max(16, this.canvas.getWidth() * 0.2),
      top: Math.max(16, this.canvas.getHeight() * 0.2),
      width: 220,
      fontSize: 24,
      fill: "#1a2f4f",
      fontFamily: "Helvetica",
      backgroundColor: "rgba(255,255,255,0.35)",
      cornerColor: "#1f4a80",
      transparentCorners: false
    });

    (textbox as fabric.Textbox & { miniObjectType?: string }).miniObjectType = "text";

    this.canvas.add(textbox);
    this.keepObjectInsideCanvas(textbox);
    this.canvas.setActiveObject(textbox);
    this.canvas.requestRenderAll();
  }

  removeActiveObject(): boolean {
    const active = this.canvas.getActiveObject();
    if (!active) {
      return false;
    }

    if (active.type === "activeSelection") {
      const selection = active as fabric.ActiveSelection;
      selection.getObjects().forEach((obj) => this.canvas.remove(obj));
    } else {
      this.canvas.remove(active);
    }

    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    return true;
  }

  removeStampObjectsById(stampId: string): number {
    const imageObjects = this.canvas.getObjects("image") as Array<fabric.Image & { miniStampId?: string }>;
    const targets = imageObjects.filter((obj) => obj.miniStampId === stampId);
    targets.forEach((obj) => this.canvas.remove(obj));

    if (targets.length > 0) {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
    }

    return targets.length;
  }

  serialize(): Record<string, unknown> {
    return this.canvas.toJSON(["miniStampId", "miniObjectType"]);
  }

  clear(): void {
    this.canvas.clear();
  }

  load(serialized: Record<string, unknown> | null): Promise<void> {
    return new Promise((resolve) => {
      if (!serialized) {
        this.clear();
        this.canvas.requestRenderAll();
        resolve();
        return;
      }

      this.canvas.loadFromJSON(serialized, () => {
        this.canvas.getObjects().forEach((obj) => this.keepObjectInsideCanvas(obj));
        this.canvas.requestRenderAll();
        resolve();
      });
    });
  }
}
