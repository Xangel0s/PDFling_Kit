import { fabric } from "fabric";

export interface StampPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
  stampId: string;
}

export interface DetectedTextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export type ShapeKind = "rect" | "ellipse" | "triangle";

export interface ShapeOptions {
  kind: ShapeKind;
  width: number;
  height: number;
  colorHex: string;
  rounded?: boolean;
}

interface ShapeSnapshot {
  kind: ShapeKind;
  width: number;
  height: number;
  colorHex: string;
  rounded?: boolean;
}

export class FabricOverlay {
  private canvas: fabric.Canvas;
  private mutationListeners = new Set<() => void>();
  private suppressMutationEmit = false;

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

    this.canvas.on("mouse:dblclick", (event) => {
      const target = event.target;
      const kind = String(target?.type ?? "");
      if (!target || (kind !== "textbox" && kind !== "i-text" && kind !== "text")) {
        return;
      }

      const editable = target as fabric.IText;
      if (typeof editable.enterEditing === "function") {
        editable.enterEditing();
      }
      if (typeof editable.selectAll === "function") {
        editable.selectAll();
      }
      this.canvas.requestRenderAll();
    });

    this.canvas.on("object:added", () => {
      this.emitMutation();
    });
    this.canvas.on("object:modified", () => {
      this.emitMutation();
    });
    this.canvas.on("object:removed", () => {
      this.emitMutation();
    });
    this.canvas.on("text:changed", () => {
      this.emitMutation();
    });
  }

  onMutation(listener: () => void): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  private emitMutation(): void {
    if (this.suppressMutationEmit) {
      return;
    }

    this.mutationListeners.forEach((listener) => {
      listener();
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
    return this.addStampImageInternal(dataUrl, stampId);
  }

  addStampImageAt(dataUrl: string, stampId: string, x: number, y: number): Promise<void> {
    return this.addStampImageInternal(dataUrl, stampId, { x, y });
  }

  private addStampImageInternal(dataUrl: string, stampId: string, dropPoint?: { x: number; y: number }): Promise<void> {
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

          const baseLeft = dropPoint
            ? (dropPoint.x - (visibleWidth / 2))
            : Math.max(8, (canvasWidth - visibleWidth) / 2);
          const baseTop = dropPoint
            ? (dropPoint.y - (visibleHeight / 2))
            : Math.max(8, (canvasHeight - visibleHeight) / 2);

          img.set({
            left: baseLeft,
            top: baseTop,
            scaleX: normalizedScale * 0.86,
            scaleY: normalizedScale * 0.86,
            opacity: 0.2,
            cornerColor: "#1f4a80",
            transparentCorners: false
          });
          (img as fabric.Image & { miniStampId?: string }).miniStampId = stampId;
          (img as fabric.Image & { miniObjectType?: string }).miniObjectType = "image";

          this.canvas.add(img);
          this.keepObjectInsideCanvas(img);
          this.canvas.setActiveObject(img);
          img.animate("scaleX", normalizedScale, {
            duration: 180,
            easing: fabric.util.ease.easeOutBack,
            onChange: () => this.canvas.requestRenderAll()
          });
          img.animate("scaleY", normalizedScale, {
            duration: 180,
            easing: fabric.util.ease.easeOutBack,
            onChange: () => this.canvas.requestRenderAll()
          });
          img.animate("opacity", 1, {
            duration: 160,
            onChange: () => this.canvas.requestRenderAll()
          });
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
      cornerColor: "#1f4a80",
      transparentCorners: false,
      opacity: 0
    });

    (textbox as fabric.Textbox & { miniObjectType?: string }).miniObjectType = "text";

    this.canvas.add(textbox);
    this.keepObjectInsideCanvas(textbox);
    this.canvas.setActiveObject(textbox);
    textbox.animate("opacity", 1, {
      duration: 170,
      onChange: () => this.canvas.requestRenderAll()
    });
    this.canvas.requestRenderAll();
  }

  addDetectedTextBlocks(blocks: DetectedTextBlock[]): number {
    const existing = this.canvas
      .getObjects()
      .filter((obj) => (obj as fabric.Object & { miniObjectType?: string }).miniObjectType === "pdf-text") as fabric.Textbox[];

    let added = 0;

    blocks.forEach((block) => {
      const alreadyExists = existing.some((obj) => {
        const sameText = (obj.text ?? "").trim() === block.text.trim();
        const dx = Math.abs((obj.left ?? 0) - block.x);
        const dy = Math.abs((obj.top ?? 0) - block.y);
        return sameText && dx < 2 && dy < 2;
      });

      if (alreadyExists) {
        return;
      }

      const textbox = new fabric.Textbox(block.text, {
        left: block.x,
        top: block.y,
        width: Math.max(24, block.width),
        fontSize: Math.max(10, block.fontSize),
        fill: "#16335b",
        fontFamily: "Helvetica",
        cornerColor: "#1f4a80",
        transparentCorners: false,
        editable: true,
        opacity: 0.96
      });

      (textbox as fabric.Textbox & { miniObjectType?: string; miniOriginalText?: string }).miniObjectType = "pdf-text";
      (textbox as fabric.Textbox & { miniObjectType?: string; miniOriginalText?: string }).miniOriginalText = block.text;

      this.canvas.add(textbox);
      this.keepObjectInsideCanvas(textbox);
      existing.push(textbox);
      added += 1;
    });

    if (added > 0) {
      this.canvas.requestRenderAll();
    }

    return added;
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

  addShape(options: ShapeOptions): void {
    const width = Math.max(20, options.width);
    const height = Math.max(20, options.height);
    const left = Math.max(16, this.canvas.getWidth() * 0.25);
    const top = Math.max(16, this.canvas.getHeight() * 0.25);
    let shape: fabric.Object;

    if (options.kind === "ellipse") {
      shape = new fabric.Ellipse({
        left,
        top,
        rx: width / 2,
        ry: height / 2,
        fill: options.colorHex,
        opacity: 0.92,
        cornerColor: "#1f4a80",
        transparentCorners: false
      });
    } else if (options.kind === "triangle") {
      shape = new fabric.Triangle({
        left,
        top,
        width,
        height,
        fill: options.colorHex,
        opacity: 0.92,
        cornerColor: "#1f4a80",
        transparentCorners: false
      });
    } else {
      const radius = options.rounded === false ? 0 : 12;
      shape = new fabric.Rect({
        left,
        top,
        width,
        height,
        fill: options.colorHex,
        rx: radius,
        ry: radius,
        opacity: 0.92,
        cornerColor: "#1f4a80",
        transparentCorners: false
      });
    }

    (shape as fabric.Object & { miniObjectType?: string; miniShapeKind?: ShapeKind }).miniObjectType = "shape";
    (shape as fabric.Object & { miniObjectType?: string; miniShapeKind?: ShapeKind }).miniShapeKind = options.kind;

    this.canvas.add(shape);
    this.keepObjectInsideCanvas(shape);
    this.canvas.setActiveObject(shape);
    this.canvas.requestRenderAll();
  }

  updateActiveShape(options: { colorHex: string; width: number; height: number; rounded?: boolean }): boolean {
    const active = this.canvas.getActiveObject() as (fabric.Object & { miniObjectType?: string; miniShapeKind?: ShapeKind }) | null;
    if (!active || active.miniObjectType !== "shape") {
      return false;
    }

    const width = Math.max(20, options.width);
    const height = Math.max(20, options.height);
    const colorHex = options.colorHex;
    const kind = active.miniShapeKind ?? "rect";

    active.set("fill", colorHex);

    if (kind === "ellipse") {
      const ellipse = active as fabric.Ellipse;
      ellipse.set({
        rx: width / 2,
        ry: height / 2,
        scaleX: 1,
        scaleY: 1
      });
    } else if (kind === "rect") {
      const rect = active as fabric.Rect;
      const radius = options.rounded === false ? 0 : 12;
      rect.set({
        width,
        height,
        scaleX: 1,
        scaleY: 1,
        rx: radius,
        ry: radius
      });
    } else {
      active.set({
        width,
        height,
        scaleX: 1,
        scaleY: 1
      });
    }

    this.keepObjectInsideCanvas(active);
    this.canvas.requestRenderAll();
    return true;
  }

  getActiveShapeSnapshot(): ShapeSnapshot | null {
    const active = this.canvas.getActiveObject() as (fabric.Object & {
      miniObjectType?: string;
      miniShapeKind?: ShapeKind;
      fill?: string;
      width?: number;
      height?: number;
      scaleX?: number;
      scaleY?: number;
      rx?: number;
      ry?: number;
    }) | null;

    if (!active || active.miniObjectType !== "shape") {
      return null;
    }

    const kind = active.miniShapeKind ?? "rect";
    if (kind === "ellipse") {
      const w = (active.rx ?? 30) * 2 * (active.scaleX ?? 1);
      const h = (active.ry ?? 30) * 2 * (active.scaleY ?? 1);
      return {
        kind,
        width: Math.round(w),
        height: Math.round(h),
        colorHex: typeof active.fill === "string" ? active.fill : "#2563eb"
      };
    }

    const w = (active.width ?? 120) * (active.scaleX ?? 1);
    const h = (active.height ?? 80) * (active.scaleY ?? 1);
    return {
      kind,
      width: Math.round(w),
      height: Math.round(h),
      colorHex: typeof active.fill === "string" ? active.fill : "#2563eb",
      rounded: kind === "rect" ? Number(active.rx ?? 0) > 0.5 : undefined
    };
  }

  serialize(): Record<string, unknown> {
    return this.canvas.toJSON(["miniStampId", "miniObjectType", "miniOriginalText", "miniShapeKind"]);
  }

  clear(): void {
    this.suppressMutationEmit = true;
    this.canvas.clear();
    this.suppressMutationEmit = false;
  }

  load(serialized: Record<string, unknown> | null): Promise<void> {
    return new Promise((resolve) => {
      this.suppressMutationEmit = true;
      if (!serialized) {
        this.clear();
        this.suppressMutationEmit = false;
        this.canvas.requestRenderAll();
        resolve();
        return;
      }

      this.canvas.loadFromJSON(serialized, () => {
        this.canvas.getObjects().forEach((obj) => {
          if (obj.type === "textbox" || obj.type === "i-text" || obj.type === "text") {
            obj.set("backgroundColor", "");
          }
          this.keepObjectInsideCanvas(obj);
        });
        this.suppressMutationEmit = false;
        this.canvas.requestRenderAll();
        resolve();
      });
    });
  }
}
