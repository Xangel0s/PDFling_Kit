import { PDFDocument } from "pdf-lib";
import type { GetSessionDataRequest, GetSessionDataResponse } from "../shared/messaging/protocol";
import { FabricOverlay, type StampPlacement } from "./canvas/FabricOverlay";
import { PdfFlattenService, type TextPlacement } from "./export/PdfFlattenService";
import { PdfRenderer, type PageTextBlock } from "./render/PdfRenderer";

const pdfCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement;
const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const canvasStackEl = document.getElementById("canvas-stack") as HTMLDivElement;
const mergeInput = document.getElementById("merge-input") as HTMLInputElement;
const mergeBtn = document.getElementById("merge-btn") as HTMLButtonElement;
const addImageBtn = document.getElementById("add-image-btn") as HTMLButtonElement;
const editTextBtn = document.getElementById("edit-text-btn") as HTMLButtonElement;
const addTextBtn = document.getElementById("add-text-btn") as HTMLButtonElement;
const deleteObjectBtn = document.getElementById("delete-object-btn") as HTMLButtonElement;
const compressBtn = document.getElementById("compress-btn") as HTMLButtonElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const exportNamePopover = document.getElementById("export-name-popover") as HTMLDivElement;
const exportNameInput = document.getElementById("export-name-input") as HTMLInputElement;
const exportConfirmBtn = document.getElementById("export-confirm-btn") as HTMLButtonElement;
const exportCancelBtn = document.getElementById("export-cancel-btn") as HTMLButtonElement;
const statusEl = document.getElementById("workspace-status") as HTMLParagraphElement;
const docNameEl = document.getElementById("doc-name") as HTMLSpanElement;
const docStatsEl = document.getElementById("doc-stats") as HTMLSpanElement;
const pageListEl = document.getElementById("page-list") as HTMLDivElement;
const pagesTitleEl = document.getElementById("pages-title") as HTMLHeadingElement;
const pageIndicatorEl = document.getElementById("page-indicator") as HTMLSpanElement;
const zoomIndicatorEl = document.getElementById("zoom-indicator") as HTMLSpanElement;
const prevPageBtn = document.getElementById("prev-page-btn") as HTMLButtonElement;
const nextPageBtn = document.getElementById("next-page-btn") as HTMLButtonElement;
const togglePagesBtn = document.getElementById("toggle-pages-btn") as HTMLButtonElement;
const pagesResizer = document.getElementById("pages-resizer") as HTMLDivElement;
const tabStamps = document.getElementById("tab-stamps") as HTMLButtonElement;
const tabAi = document.getElementById("tab-ai") as HTMLButtonElement | null;
const stampsPanel = document.getElementById("stamps-panel") as HTMLElement;
const aiPanel = document.getElementById("ai-panel") as HTMLElement | null;
const uploadStampBtn = document.getElementById("upload-stamp-btn") as HTMLButtonElement;
const stampDropzone = document.getElementById("stamp-dropzone") as HTMLDivElement;
const stampUploadInput = document.getElementById("stamp-upload-input") as HTMLInputElement;
const stampLibraryEl = document.getElementById("stamp-library") as HTMLDivElement;
const canvasScrollArea = document.querySelector(".canvas-scroll-area") as HTMLDivElement;

const renderer = new PdfRenderer();
const overlay = new FabricOverlay(overlayCanvas);
const flattenService = new PdfFlattenService();

const STAMP_LIBRARY_KEY = "stampLibrary";
const WORKSPACE_PENDING_ACTION_KEY = "workspacePendingAction";

interface StampLibraryItem {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  bytes: number[];
  createdAt: number;
}

interface PendingWorkspaceAction {
  sessionId: string;
  mode: "add-image" | "edit-text";
  imageDataUrl?: string;
  imageName?: string;
}

let sourcePdfBuffer: ArrayBuffer | null = null;
let sourceFileName = "documento.pdf";
let renderScale = 1.25;
let pageCount = 1;
let currentPage = 1;
let pendingExportBlob: Blob | null = null;
let pendingDownloadMode: "export" | "compress" = "export";
let statusHideTimer: number | null = null;
let draggingStampId: string | null = null;
let textEditModeEnabled = false;
let isSpacePanReady = false;
let isSpacePanning = false;
let panStartClientX = 0;
let panStartClientY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;
const pageOverlayState = new Map<number, Record<string, unknown>>();
const stampLibrary = new Map<string, StampLibraryItem>();
const pageThumbnailCache = new Map<number, string>();
const A4_PLACEHOLDER_WIDTH = 595;
const A4_PLACEHOLDER_HEIGHT = 842;
const MIN_CANVAS_ZOOM = 0.4;
const MAX_CANVAS_ZOOM = 2.5;
const CANVAS_ZOOM_STEP = 0.1;
let canvasZoom = 1;
let lastCanvasScrollLeft = 0;
let lastCanvasScrollTop = 0;

function debugCanvasLog(step: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.info(`[MiniSterling][canvas] ${step}`, detail);
    return;
  }

  console.info(`[MiniSterling][canvas] ${step}`);
}

function remapPageStateAfterDelete<T>(source: Map<number, T>, deletedPage: number): Map<number, T> {
  const next = new Map<number, T>();
  source.forEach((value, key) => {
    if (key === deletedPage) {
      return;
    }

    const mappedKey = key > deletedPage ? key - 1 : key;
    next.set(mappedKey, value);
  });
  return next;
}

function setStatus(message: string, ttlMs = 4200): void {
  if (statusHideTimer !== null) {
    window.clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }

  statusEl.textContent = message;
  statusEl.classList.add("is-visible");

  if (ttlMs <= 0) {
    return;
  }

  statusHideTimer = window.setTimeout(() => {
    statusEl.textContent = "";
    statusEl.classList.remove("is-visible");
    statusHideTimer = null;
  }, ttlMs);
}

function renderA4Placeholder(): void {
  pdfCanvas.width = A4_PLACEHOLDER_WIDTH;
  pdfCanvas.height = A4_PLACEHOLDER_HEIGHT;
  const ctx = pdfCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  }

  overlay.resize(A4_PLACEHOLDER_WIDTH, A4_PLACEHOLDER_HEIGHT);
}

function truncateMiddle(value: string, maxLength = 48): string {
  if (value.length <= maxLength) {
    return value;
  }

  const side = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, side)}...${value.slice(-side)}`;
}

function updateDocumentMeta(): void {
  const name = sourceFileName || "Documento activo";
  docNameEl.textContent = truncateMiddle(name);
  docNameEl.title = name;
  docStatsEl.textContent = `${pageCount} paginas`;
}

function getSuggestedExportName(mode: "export" | "compress" = "export"): string {
  const base = sourceFileName.toLowerCase().endsWith(".pdf")
    ? sourceFileName.slice(0, -4)
    : sourceFileName;
  return mode === "compress" ? `${base}_comprimido` : `${base}_exportado`;
}

function normalizeExportFileName(rawName: string): string {
  const stripped = rawName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ");

  const fallback = getSuggestedExportName(pendingDownloadMode);
  const safeBase = stripped.length > 0 ? stripped : fallback;
  return safeBase.toLowerCase().endsWith(".pdf") ? safeBase : `${safeBase}.pdf`;
}

function openExportNamePopover(): void {
  if (!pendingExportBlob) {
    return;
  }

  exportNamePopover.hidden = false;
  exportNameInput.value = getSuggestedExportName(pendingDownloadMode);
  exportNameInput.focus();
  exportNameInput.select();
}

function closeExportNamePopover(clearPending = false): void {
  exportNamePopover.hidden = true;
  if (clearPending) {
    pendingExportBlob = null;
  }
}

function downloadPendingExport(): void {
  if (!pendingExportBlob) {
    return;
  }

  const finalFileName = normalizeExportFileName(exportNameInput.value);
  const downloadUrl = URL.createObjectURL(pendingExportBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = finalFileName;
  link.click();
  URL.revokeObjectURL(downloadUrl);

  closeExportNamePopover(true);
  const verb = pendingDownloadMode === "compress" ? "comprimido" : "exportado";
  setStatus(`PDF ${verb} correctamente como ${finalFileName}.`);
}

function updateZoomIndicator(): void {
  zoomIndicatorEl.textContent = `${Math.round(canvasZoom * 100)}%`;
}

function clampCanvasScroll(source: string): void {
  const maxLeft = Math.max(0, canvasScrollArea.scrollWidth - canvasScrollArea.clientWidth);
  const maxTop = Math.max(0, canvasScrollArea.scrollHeight - canvasScrollArea.clientHeight);
  const nextLeft = Math.max(0, Math.min(canvasScrollArea.scrollLeft, maxLeft));
  const nextTop = Math.max(0, Math.min(canvasScrollArea.scrollTop, maxTop));

  if (nextLeft !== canvasScrollArea.scrollLeft || nextTop !== canvasScrollArea.scrollTop) {
    canvasScrollArea.scrollLeft = nextLeft;
    canvasScrollArea.scrollTop = nextTop;
    debugCanvasLog("clamp-scroll", { source, nextLeft, nextTop, maxLeft, maxTop });
  }
}

function applyCanvasZoom(nextZoom: number): void {
  const previousZoom = canvasZoom;
  const viewportCenterX = canvasScrollArea.scrollLeft + (canvasScrollArea.clientWidth / 2);
  const viewportCenterY = canvasScrollArea.scrollTop + (canvasScrollArea.clientHeight / 2);
  const logicalCenterX = viewportCenterX / Math.max(previousZoom, 0.0001);
  const logicalCenterY = viewportCenterY / Math.max(previousZoom, 0.0001);

  const clamped = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, nextZoom));
  canvasZoom = Number(clamped.toFixed(2));
  canvasStackEl.style.setProperty("zoom", String(canvasZoom));

  const targetCenterX = logicalCenterX * canvasZoom;
  const targetCenterY = logicalCenterY * canvasZoom;
  canvasScrollArea.scrollLeft = Math.max(0, targetCenterX - (canvasScrollArea.clientWidth / 2));
  canvasScrollArea.scrollTop = Math.max(0, targetCenterY - (canvasScrollArea.clientHeight / 2));
  clampCanvasScroll("applyCanvasZoom");

  updateZoomIndicator();
  debugCanvasLog("zoom", {
    from: previousZoom,
    to: canvasZoom,
    scrollLeft: canvasScrollArea.scrollLeft,
    scrollTop: canvasScrollArea.scrollTop
  });
}

function adjustCanvasZoom(stepDelta: number): void {
  applyCanvasZoom(canvasZoom + stepDelta);
}

function initializeCanvasZoom(): void {
  applyCanvasZoom(1);

  canvasScrollArea.addEventListener("scroll", () => {
    const maxLeft = Math.max(0, canvasScrollArea.scrollWidth - canvasScrollArea.clientWidth);
    const maxTop = Math.max(0, canvasScrollArea.scrollHeight - canvasScrollArea.clientHeight);
    const deltaLeft = canvasScrollArea.scrollLeft - lastCanvasScrollLeft;
    const deltaTop = canvasScrollArea.scrollTop - lastCanvasScrollTop;

    if (Math.abs(deltaLeft) > 120 || Math.abs(deltaTop) > 120) {
      debugCanvasLog("scroll-jump", {
        scrollLeft: canvasScrollArea.scrollLeft,
        scrollTop: canvasScrollArea.scrollTop,
        deltaLeft,
        deltaTop,
        maxLeft,
        maxTop,
        zoom: canvasZoom,
        isSpacePanning,
        isSpacePanReady
      });

      if (!isSpacePanning && deltaLeft > 120 && canvasScrollArea.scrollLeft >= (maxLeft - 1) && lastCanvasScrollLeft < (maxLeft - 2)) {
        canvasScrollArea.scrollLeft = Math.max(0, lastCanvasScrollLeft);
        debugCanvasLog("auto-unstick-right", {
          restoredLeft: canvasScrollArea.scrollLeft,
          previousLeft: lastCanvasScrollLeft,
          maxLeft,
          zoom: canvasZoom
        });
      }
    }

    if (canvasScrollArea.scrollLeft >= (maxLeft - 1) && maxLeft > 0) {
      debugCanvasLog("at-right-edge", { scrollLeft: canvasScrollArea.scrollLeft, maxLeft, zoom: canvasZoom });
    }

    lastCanvasScrollLeft = canvasScrollArea.scrollLeft;
    lastCanvasScrollTop = canvasScrollArea.scrollTop;
  });

  canvasScrollArea.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      const step = event.deltaY > 0 ? -CANVAS_ZOOM_STEP : CANVAS_ZOOM_STEP;
      adjustCanvasZoom(step);
    },
    { passive: false }
  );

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (targetTag === "textarea" || targetTag === "input") {
      return;
    }

    if (!event.ctrlKey) {
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      adjustCanvasZoom(CANVAS_ZOOM_STEP);
      return;
    }

    if (event.key === "-") {
      event.preventDefault();
      adjustCanvasZoom(-CANVAS_ZOOM_STEP);
      return;
    }

    if (event.key === "0") {
      event.preventDefault();
      applyCanvasZoom(1);
    }
  });
}

function initializeCanvasPan(): void {
  const setSpacePanReady = (enabled: boolean): void => {
    isSpacePanReady = enabled;
    document.body.classList.toggle("space-pan-ready", enabled);
  };

  const stopPanning = (): void => {
    if (!isSpacePanning) {
      return;
    }

    isSpacePanning = false;
    document.body.classList.remove("space-pan-active");
  };

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (targetTag === "textarea" || targetTag === "input") {
      return;
    }

    if (event.code !== "Space") {
      return;
    }

    event.preventDefault();
    if (!isSpacePanReady) {
      setSpacePanReady(true);
    }
  });

  document.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.code !== "Space") {
      return;
    }

    setSpacePanReady(false);
    stopPanning();
  });

  canvasScrollArea.addEventListener("mousedown", (event: MouseEvent) => {
    if (!isSpacePanReady || event.button !== 0) {
      return;
    }

    isSpacePanning = true;
    panStartClientX = event.clientX;
    panStartClientY = event.clientY;
    panStartScrollLeft = canvasScrollArea.scrollLeft;
    panStartScrollTop = canvasScrollArea.scrollTop;
    document.body.classList.add("space-pan-active");
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event: MouseEvent) => {
    if (!isSpacePanning) {
      return;
    }

    const deltaX = event.clientX - panStartClientX;
    const deltaY = event.clientY - panStartClientY;
    canvasScrollArea.scrollLeft = panStartScrollLeft - deltaX;
    canvasScrollArea.scrollTop = panStartScrollTop - deltaY;
    event.preventDefault();
  });

  window.addEventListener("mouseup", () => {
    stopPanning();
  });

  window.addEventListener("blur", () => {
    setSpacePanReady(false);
    stopPanning();
  });
}

function getShareSummary(): string {
  return `Mini Sterling | ${sourceFileName} | Pagina ${currentPage}/${pageCount}`;
}

function initializePagesSidebarControls(): void {
  const minWidth = 96;
  const maxWidth = 260;
  let dragging = false;

  togglePagesBtn.addEventListener("click", () => {
    document.body.classList.toggle("pages-collapsed");
  });

  pagesResizer.addEventListener("mousedown", (event: MouseEvent) => {
    if (document.body.classList.contains("pages-collapsed")) {
      return;
    }

    dragging = true;
    document.body.classList.add("resizing-pages");
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event: MouseEvent) => {
    if (!dragging) {
      return;
    }

    const nextWidth = Math.min(maxWidth, Math.max(minWidth, event.clientX));
    document.documentElement.style.setProperty("--pages-width", `${nextWidth}px`);
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    document.body.classList.remove("resizing-pages");
  });
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function tryToArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as Uint8Array;
    const copied = new Uint8Array(view.byteLength);
    copied.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copied.buffer;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Uint8Array(value as number[]).buffer;
  }

  if (value && typeof value === "object") {
    const asRecord = value as Record<string, unknown>;

    if (Array.isArray(asRecord.data) && asRecord.data.every((item) => typeof item === "number")) {
      return new Uint8Array(asRecord.data as number[]).buffer;
    }

    if (typeof asRecord.length === "number" && Number.isFinite(asRecord.length)) {
      const size = Math.max(0, Math.floor(asRecord.length));
      const maybeArrayLike = Array.from({ length: size }, (_, index) => asRecord[String(index)]);
      if (maybeArrayLike.every((item) => typeof item === "number")) {
        return new Uint8Array(maybeArrayLike as number[]).buffer;
      }
    }

    const numeric = Object.values(asRecord);
    if (numeric.length > 0 && numeric.every((item) => typeof item === "number")) {
      return new Uint8Array(numeric as number[]).buffer;
    }
  }

  return null;
}

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getSourcePdfBufferCopy(): ArrayBuffer {
  if (!sourcePdfBuffer) {
    throw new Error("No hay PDF cargado.");
  }

  return cloneArrayBuffer(sourcePdfBuffer);
}

function normalizePdfBinary(value: unknown): ArrayBuffer {
  const direct = tryToArrayBuffer(value);
  if (direct) {
    return direct;
  }

  if (value && typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    const nestedCandidates = [
      asRecord.arrayBuffer,
      asRecord.buffer,
      asRecord.data,
      asRecord.payload,
      asRecord.pdf,
      asRecord.binary,
      asRecord.bytes,
      asRecord.value
    ];

    for (const candidate of nestedCandidates) {
      const normalized = tryToArrayBuffer(candidate);
      if (normalized) {
        return normalized;
      }

      if (candidate && typeof candidate === "object") {
        const deep = candidate as Record<string, unknown>;
        const deepNormalized = tryToArrayBuffer(deep.data ?? deep.buffer ?? deep.arrayBuffer ?? deep.value);
        if (deepNormalized) {
          return deepNormalized;
        }
      }
    }
  }

  const kind = Object.prototype.toString.call(value);
  throw new Error(`Datos PDF invalidos recibidos (tipo: ${kind}).`);
}

function toggleToolTab(tab: "stamps" | "ai" = "stamps"): void {
  const stampsActive = tab !== "ai" || !tabAi || !aiPanel;
  tabStamps.classList.toggle("active", stampsActive);
  if (tabAi) {
    tabAi.classList.toggle("active", !stampsActive);
  }
  stampsPanel.classList.toggle("active", stampsActive);
  if (aiPanel) {
    aiPanel.classList.toggle("active", !stampsActive);
  }
}

async function loadStampLibrary(): Promise<void> {
  const stored = await chrome.storage.local.get([STAMP_LIBRARY_KEY]);
  const list = (stored[STAMP_LIBRARY_KEY] as StampLibraryItem[] | undefined) ?? [];
  stampLibrary.clear();
  list.forEach((item) => {
    stampLibrary.set(item.id, item);
  });
  renderStampLibrary();
}

async function saveStampLibrary(): Promise<void> {
  const values = Array.from(stampLibrary.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
  await chrome.storage.local.set({ [STAMP_LIBRARY_KEY]: values });
}

function renderStampLibrary(): void {
  stampLibraryEl.innerHTML = "";

  if (stampLibrary.size === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-hint";
    empty.textContent = "No hay sellos guardados. Sube una imagen para comenzar.";
    stampLibraryEl.appendChild(empty);
    return;
  }

  Array.from(stampLibrary.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((item) => {
      const btn = document.createElement("div");
      btn.className = "stamp-item";
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      btn.draggable = true;

      const img = document.createElement("img");
      img.src = item.dataUrl;
      img.alt = item.name;

      const label = document.createElement("span");
      label.textContent = item.name;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "stamp-delete-btn";
      removeBtn.title = `Eliminar sello ${item.name}`;
      removeBtn.setAttribute("aria-label", `Eliminar sello ${item.name}`);

      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.textContent = "delete";
      removeBtn.appendChild(icon);

      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void removeStampFromLibrary(item.id);
      });

      btn.appendChild(img);
      btn.appendChild(label);
      btn.appendChild(removeBtn);
      btn.addEventListener("click", () => {
        void overlay.addStampImage(item.dataUrl, item.id);
        setStatus(`Sello aplicado: ${item.name}`);
      });
      btn.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void overlay.addStampImage(item.dataUrl, item.id);
          setStatus(`Sello aplicado: ${item.name}`);
        }
      });
      btn.addEventListener("dragstart", (event: DragEvent) => {
        draggingStampId = item.id;
        btn.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", item.id);
        }
      });
      btn.addEventListener("dragend", () => {
        draggingStampId = null;
        btn.classList.remove("is-dragging");
        canvasStackEl.classList.remove("drop-ready");
      });

      stampLibraryEl.appendChild(btn);
    });
}

async function upsertStampFromFile(file: File, applyAfterImport: boolean): Promise<boolean> {
  if (!file.type.startsWith("image/")) {
    return false;
  }

  const buffer = await file.arrayBuffer();
  const dataUrl = bufferToDataUrl(buffer, file.type || "image/png");
  const existing = Array.from(stampLibrary.values()).find((entry) => entry.dataUrl === dataUrl);
  if (existing) {
    if (applyAfterImport) {
      await overlay.addStampImage(existing.dataUrl, existing.id);
    }
    return false;
  }

  const id = crypto.randomUUID();
  stampLibrary.set(id, {
    id,
    name: file.name,
    mimeType: file.type || "image/png",
    dataUrl,
    bytes: Array.from(new Uint8Array(buffer)),
    createdAt: Date.now()
  });

  if (applyAfterImport) {
    await overlay.addStampImage(dataUrl, id);
  }

  return true;
}

async function upsertStampFromDataUrl(name: string, mimeType: string, dataUrl: string, applyAfterImport: boolean): Promise<boolean> {
  if (!dataUrl.startsWith("data:image/")) {
    return false;
  }

  const existing = Array.from(stampLibrary.values()).find((entry) => entry.dataUrl === dataUrl);
  if (existing) {
    if (applyAfterImport) {
      await overlay.addStampImage(existing.dataUrl, existing.id);
    }
    return false;
  }

  const payload = dataUrl.split(",")[1] ?? "";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const id = crypto.randomUUID();
  stampLibrary.set(id, {
    id,
    name,
    mimeType,
    dataUrl,
    bytes: Array.from(bytes),
    createdAt: Date.now()
  });

  if (applyAfterImport) {
    await overlay.addStampImage(dataUrl, id);
  }

  return true;
}

async function detectEditableTextOnCurrentPage(): Promise<void> {
  if (!sourcePdfBuffer) {
    setStatus("Carga un PDF antes de editar texto.");
    return;
  }

  const blocks = await renderer.extractPageTextBlocks(currentPage, renderScale);
  if (blocks.length === 0) {
    setStatus("No se detecto texto editable en esta pagina.");
    return;
  }

  const normalized: PageTextBlock[] = blocks
    .map((block) => ({
      ...block,
      width: Math.min(pdfCanvas.width - block.x, Math.max(20, block.width))
    }))
    .filter((block) => block.width > 0 && block.y < pdfCanvas.height);

  const added = overlay.addDetectedTextBlocks(normalized);
  await persistCurrentPageOverlay();

  if (added > 0) {
    setStatus(`Analisis completado en pagina ${currentPage}: ${added} bloque(s) editable(s). Doble clic para editar.`);
  } else {
    setStatus("El texto de esta pagina ya estaba listo para editar.");
  }
}

async function buildFlattenedPdfBlob(requireOverlayContent: boolean): Promise<Blob | null> {
  if (!sourcePdfBuffer) {
    return null;
  }

  await persistCurrentPageOverlay();

  const allPlacements: StampPlacement[] = [];
  const allTextPlacements: TextPlacement[] = [];
  pageOverlayState.forEach((serialized, pageNumber) => {
    allPlacements.push(...collectPlacementsFromSerialized(serialized, pageNumber - 1));
    allTextPlacements.push(...collectTextPlacementsFromSerialized(serialized, pageNumber - 1));
  });

  const hasOverlayContent = allPlacements.length > 0 || allTextPlacements.length > 0;
  if (requireOverlayContent && !hasOverlayContent) {
    setStatus("No hay imagenes ni textos colocados para exportar.");
    return null;
  }

  if (!hasOverlayContent) {
    return new Blob([getSourcePdfBufferCopy()], { type: "application/pdf" });
  }

  const stampAssets = Array.from(stampLibrary.values()).reduce<Record<string, { bytes: Uint8Array; mimeType: string }>>((acc, item) => {
    acc[item.id] = {
      bytes: new Uint8Array(item.bytes),
      mimeType: item.mimeType
    };
    return acc;
  }, {});

  return flattenService.exportDocument({
    sourcePdfBuffer: getSourcePdfBufferCopy(),
    placements: allPlacements,
    stampAssets,
    textPlacements: allTextPlacements,
    renderScale
  });
}

async function compressCurrentPdf(): Promise<void> {
  if (!sourcePdfBuffer) {
    setStatus("No hay PDF cargado para comprimir.");
    return;
  }

  setStatus("Comprimiendo PDF...");

  const baseBlob = await buildFlattenedPdfBlob(false);
  if (!baseBlob) {
    setStatus("No fue posible preparar el PDF para compresion.");
    return;
  }

  const originalBuffer = getSourcePdfBufferCopy();
  const preparedBytes = new Uint8Array(await baseBlob.arrayBuffer());
  const preparedDoc = await PDFDocument.load(preparedBytes);
  const compressedBytes = await preparedDoc.save({ useObjectStreams: true, addDefaultPage: false });

  const compressedBlob = new Blob([new Uint8Array(compressedBytes)], { type: "application/pdf" });
  pendingExportBlob = compressedBlob;
  pendingDownloadMode = "compress";
  openExportNamePopover();

  const deltaKb = Math.round((originalBuffer.byteLength - compressedBlob.size) / 1024);
  const summary = deltaKb > 0
    ? `PDF comprimido listo (${deltaKb} KB menos). Define nombre y guarda.`
    : "PDF comprimido listo. Define nombre y guarda.";
  setStatus(summary);
}

async function handleStampFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  if (files.length === 0) {
    return;
  }

  let added = 0;
  let reused = 0;
  let firstApplied = false;

  for (const file of files) {
    const imported = await upsertStampFromFile(file, !firstApplied);
    if (imported) {
      added += 1;
      if (!firstApplied) {
        firstApplied = true;
      }
    } else {
      reused += 1;
    }
  }

  await saveStampLibrary();
  renderStampLibrary();

  if (added > 0) {
    setStatus(`Importacion completada: ${added} sello(s) nuevo(s).`);
  } else if (reused > 0) {
    setStatus("Esas imagenes ya existian en tu biblioteca de sellos.");
  }
}

function initializeStampDropzone(): void {
  const openPicker = (): void => {
    stampUploadInput.click();
  };

  stampDropzone.addEventListener("click", openPicker);
  stampDropzone.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });

  stampDropzone.addEventListener("dragover", (event: DragEvent) => {
    event.preventDefault();
    stampDropzone.classList.add("dragover");
  });

  stampDropzone.addEventListener("dragleave", () => {
    stampDropzone.classList.remove("dragover");
  });

  stampDropzone.addEventListener("drop", (event: DragEvent) => {
    event.preventDefault();
    stampDropzone.classList.remove("dragover");

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }

    void handleStampFiles(files);
  });
}

function initializeCanvasStampDrop(): void {
  canvasStackEl.addEventListener("dragover", (event: DragEvent) => {
    const payload = draggingStampId || event.dataTransfer?.getData("text/plain");
    if (!payload) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    canvasStackEl.classList.add("drop-ready");
  });

  canvasStackEl.addEventListener("dragleave", () => {
    canvasStackEl.classList.remove("drop-ready");
  });

  canvasStackEl.addEventListener("drop", (event: DragEvent) => {
    const payload = draggingStampId || event.dataTransfer?.getData("text/plain");
    if (!payload) {
      return;
    }

    event.preventDefault();
    canvasStackEl.classList.remove("drop-ready");

    const stamp = stampLibrary.get(payload);
    if (!stamp) {
      return;
    }

    const rect = pdfCanvas.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return;
    }

    const x = (clientX - rect.left) * (pdfCanvas.width / rect.width);
    const y = (clientY - rect.top) * (pdfCanvas.height / rect.height);
    void overlay.addStampImageAt(stamp.dataUrl, stamp.id, x, y);
    setStatus(`Sello colocado: ${stamp.name}`);
  });
}

async function removeStampFromLibrary(stampId: string): Promise<void> {
  const stamp = stampLibrary.get(stampId);
  if (!stamp) {
    return;
  }

  const currentPageState = overlay.serialize();
  pageOverlayState.set(currentPage, currentPageState);

  const removedInCurrent = overlay.removeStampObjectsById(stampId);

  pageOverlayState.forEach((serialized, pageNumber) => {
    const objects = Array.isArray((serialized as { objects?: unknown[] }).objects)
      ? ((serialized as { objects?: unknown[] }).objects as unknown[])
      : [];

    const filteredObjects = objects.filter((obj) => {
      const record = obj as Record<string, unknown>;
      return String(record.miniStampId ?? "") !== stampId;
    });

    if (filteredObjects.length !== objects.length) {
      const nextSerialized = {
        ...(serialized as Record<string, unknown>),
        objects: filteredObjects
      };
      pageOverlayState.set(pageNumber, nextSerialized);
    }
  });

  stampLibrary.delete(stampId);
  await saveStampLibrary();
  renderStampLibrary();
  if (removedInCurrent > 0) {
    pageOverlayState.set(currentPage, overlay.serialize());
  }

  setStatus(`Sello eliminado: ${stamp.name}. Se limpiaron sus apariciones guardadas.`);
}

function updatePageIndicator(): void {
  if (!sourcePdfBuffer) {
    pageIndicatorEl.textContent = "Sin PDF";
    pagesTitleEl.textContent = "Pages";
    return;
  }

  pageIndicatorEl.textContent = `Pagina ${currentPage} / ${pageCount}`;
  pagesTitleEl.textContent = `Pages (${pageCount})`;
}

function createImportPdfCard(): HTMLButtonElement {
  const importCard = document.createElement("button");
  importCard.type = "button";
  importCard.className = "page-import-card";
  importCard.innerHTML = "<span class=\"material-symbols-outlined\">upload_file</span><span>Importar PDF<br/>- - - -</span>";
  importCard.addEventListener("click", () => {
    mergeInput.click();
  });
  return importCard;
}

function renderEmptyPageList(): void {
  pageListEl.innerHTML = "";

  const hint = document.createElement("p");
  hint.className = "page-empty-hint";
  hint.textContent = "No hay PDF cargado.";
  pageListEl.appendChild(hint);

  pageListEl.appendChild(createImportPdfCard());
}

function collectPlacementsFromSerialized(serialized: Record<string, unknown>, pageIndex: number): StampPlacement[] {
  const objects = Array.isArray((serialized as { objects?: unknown[] }).objects)
    ? ((serialized as { objects?: unknown[] }).objects as unknown[])
    : [];

  return objects
    .map((obj) => obj as Record<string, unknown>)
    .filter((obj) => obj.type === "image")
    .map((obj) => {
      const width = Number(obj.width ?? 0) * Number(obj.scaleX ?? 1);
      const height = Number(obj.height ?? 0) * Number(obj.scaleY ?? 1);
      return {
        x: Number(obj.left ?? 0),
        y: Number(obj.top ?? 0),
        width,
        height,
        pageIndex,
        stampId: String(obj.miniStampId ?? "")
      };
    })
    .filter((item) => item.width > 0 && item.height > 0 && Boolean(item.stampId));
}

function normalizeColor(value: unknown): string {
  if (typeof value !== "string") {
    return "#1a2f4f";
  }

  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }

  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbMatch) {
    return "#1a2f4f";
  }

  const r = Number(rgbMatch[1]).toString(16).padStart(2, "0");
  const g = Number(rgbMatch[2]).toString(16).padStart(2, "0");
  const b = Number(rgbMatch[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function collectTextPlacementsFromSerialized(serialized: Record<string, unknown>, pageIndex: number): TextPlacement[] {
  const objects = Array.isArray((serialized as { objects?: unknown[] }).objects)
    ? ((serialized as { objects?: unknown[] }).objects as unknown[])
    : [];

  return objects
    .map((obj) => obj as Record<string, unknown>)
    .filter((obj) => ["i-text", "textbox", "text"].includes(String(obj.type ?? "")))
    .map((obj): TextPlacement | null => {
      const width = Number(obj.width ?? 0) * Number(obj.scaleX ?? 1);
      const height = Number(obj.height ?? 0) * Number(obj.scaleY ?? 1);
      const fontSize = Number(obj.fontSize ?? 18) * Number(obj.scaleY ?? 1);
      const objectKind = String(obj.miniObjectType ?? "");
      const currentText = String(obj.text ?? "");
      const originalText = String(obj.miniOriginalText ?? "");
      const isDetectedBlock = objectKind === "pdf-text";
      const isEditedReplacement = isDetectedBlock && currentText.trim() !== originalText.trim();

      if (isDetectedBlock && !isEditedReplacement) {
        return null;
      }

      return {
        pageIndex,
        x: Number(obj.left ?? 0),
        y: Number(obj.top ?? 0),
        width,
        height,
        text: currentText,
        fontSize,
        colorHex: normalizeColor(obj.fill),
        eraseOriginal: isEditedReplacement ? true : undefined
      };
    })
    .filter((item): item is TextPlacement => Boolean(item && item.text.trim()));
}

async function renderPageThumbs(): Promise<void> {
  if (!sourcePdfBuffer) {
    renderEmptyPageList();
    return;
  }

  pageListEl.innerHTML = "";

  const thumbnailJobs: Promise<void>[] = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const item = document.createElement("div");
    item.className = `page-thumb ${page === currentPage ? "active" : ""}`;
    item.dataset.page = String(page);
    item.tabIndex = 0;

    const preview = document.createElement("div");
    preview.className = "thumb-preview";

    const previewImg = document.createElement("img");
    previewImg.className = "thumb-image";
    previewImg.alt = `Miniatura de pagina ${page}`;

    const cachedThumbnail = pageThumbnailCache.get(page);
    if (cachedThumbnail) {
      previewImg.src = cachedThumbnail;
      preview.classList.add("ready");
    } else {
      const loading = document.createElement("span");
      loading.className = "thumb-loading";
      loading.textContent = "Cargando...";
      preview.appendChild(loading);

      const job = renderer
        .renderPageThumbnail(page, 84)
        .then((thumbnailDataUrl) => {
          pageThumbnailCache.set(page, thumbnailDataUrl);
          previewImg.src = thumbnailDataUrl;
          preview.classList.add("ready");
          loading.remove();
        })
        .catch(() => {
          loading.textContent = `P${page}`;
        });

      thumbnailJobs.push(job);
    }

    preview.appendChild(previewImg);

    const label = document.createElement("span");
    label.className = "thumb-label";
    label.textContent = `Pagina ${page}`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "thumb-delete-btn";
    deleteBtn.title = `Eliminar pagina ${page}`;
    deleteBtn.setAttribute("aria-label", `Eliminar pagina ${page}`);

    const deleteIcon = document.createElement("span");
    deleteIcon.className = "material-symbols-outlined";
    deleteIcon.textContent = "delete";
    deleteBtn.appendChild(deleteIcon);

    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void deletePage(page);
    });

    item.appendChild(preview);
    item.appendChild(label);
    item.appendChild(deleteBtn);
    item.addEventListener("click", () => {
      void goToPage(page);
    });
    item.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void goToPage(page);
      }
    });

    pageListEl.appendChild(item);
  }

  pageListEl.appendChild(createImportPdfCard());

  await Promise.allSettled(thumbnailJobs);
}

async function persistCurrentPageOverlay(): Promise<void> {
  pageOverlayState.set(currentPage, overlay.serialize());
}

async function renderCurrentPage(): Promise<void> {
  const result = await renderer.renderPage(currentPage, pdfCanvas, renderScale);
  overlay.resize(result.width, result.height);
  const pageJson = pageOverlayState.get(currentPage) ?? null;
  await overlay.load(pageJson);
  requestAnimationFrame(() => {
    clampCanvasScroll("renderCurrentPage");
    debugCanvasLog("render-page", {
      page: currentPage,
      width: result.width,
      height: result.height,
      zoom: canvasZoom,
      scrollLeft: canvasScrollArea.scrollLeft,
      scrollTop: canvasScrollArea.scrollTop
    });
  });
  updatePageIndicator();
  void renderPageThumbs();
}

async function goToPage(nextPage: number): Promise<void> {
  if (nextPage < 1 || nextPage > pageCount || nextPage === currentPage) {
    return;
  }

  await persistCurrentPageOverlay();
  currentPage = nextPage;
  await renderCurrentPage();
  if (textEditModeEnabled) {
    await detectEditableTextOnCurrentPage();
  }
}

async function deletePage(pageToDelete: number): Promise<void> {
  if (!sourcePdfBuffer) {
    setStatus("No hay PDF cargado para eliminar paginas.");
    return;
  }

  if (pageCount <= 1) {
    setStatus("No se puede eliminar la unica pagina del documento.");
    return;
  }

  if (pageToDelete < 1 || pageToDelete > pageCount) {
    return;
  }

  setStatus(`Eliminando pagina ${pageToDelete}...`);

  try {
    const pdfDoc = await PDFDocument.load(getSourcePdfBufferCopy());
    pdfDoc.removePage(pageToDelete - 1);
    const nextBytes = await pdfDoc.save();
    sourcePdfBuffer = new Uint8Array(nextBytes).buffer;

    const nextOverlayState = remapPageStateAfterDelete(pageOverlayState, pageToDelete);
    pageOverlayState.clear();
    nextOverlayState.forEach((value, key) => pageOverlayState.set(key, value));

    const nextThumbState = remapPageStateAfterDelete(pageThumbnailCache, pageToDelete);
    pageThumbnailCache.clear();
    nextThumbState.forEach((value, key) => pageThumbnailCache.set(key, value));

    pageCount = await renderer.loadDocument(getSourcePdfBufferCopy());
    currentPage = Math.min(currentPage, pageCount);
    if (currentPage >= pageToDelete) {
      currentPage = Math.max(1, currentPage - 1);
    }

    await renderCurrentPage();
    updateDocumentMeta();
    setStatus(`Pagina ${pageToDelete} eliminada correctamente.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar la pagina.";
    setStatus(message);
  }
}

function getSessionId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("sessionId");
}

async function consumePendingWorkspaceAction(sessionId: string): Promise<PendingWorkspaceAction | null> {
  const stored = await chrome.storage.local.get([WORKSPACE_PENDING_ACTION_KEY]);
  const action = (stored[WORKSPACE_PENDING_ACTION_KEY] as PendingWorkspaceAction | undefined) ?? null;
  if (!action || action.sessionId !== sessionId) {
    return null;
  }

  await chrome.storage.local.remove(WORKSPACE_PENDING_ACTION_KEY);
  return action;
}

async function applyPendingWorkspaceAction(action: PendingWorkspaceAction): Promise<void> {
  if (action.mode === "add-image") {
    toggleToolTab("stamps");

    if (!action.imageDataUrl) {
      setStatus("No se recibio imagen para agregar.");
      return;
    }

    const imported = await upsertStampFromDataUrl(action.imageName ?? "imagen_importada", "image/png", action.imageDataUrl, true);
    await saveStampLibrary();
    renderStampLibrary();

    if (imported) {
      setStatus("Imagen importada y aplicada. Puedes arrastrarla o editarla.");
    } else {
      setStatus("La imagen ya existia en la biblioteca y fue aplicada.");
    }
    return;
  }

  if (action.mode === "edit-text") {
    textEditModeEnabled = true;
    await detectEditableTextOnCurrentPage();
  }
}

async function loadSessionPdf(): Promise<void> {
  const sessionId = getSessionId();
  if (!sessionId) {
    renderA4Placeholder();
    void renderPageThumbs();
    updatePageIndicator();
    setStatus("Sesion invalida: falta sessionId.");
    return;
  }

  const req: GetSessionDataRequest = {
    type: "GET_SESSION_DATA",
    payload: { sessionId }
  };

  setStatus("Cargando PDF de sesion...");
  const response = await chrome.runtime.sendMessage(req) as GetSessionDataResponse;
  if (!response.ok || !response.arrayBuffer) {
    renderA4Placeholder();
    void renderPageThumbs();
    updatePageIndicator();
    setStatus(response.error ?? "No se pudo recuperar el PDF.");
    return;
  }

  try {
    sourcePdfBuffer = cloneArrayBuffer(normalizePdfBinary(response.arrayBuffer));
    sourceFileName = response.fileName ?? "documento.pdf";
    pageOverlayState.clear();
    pageThumbnailCache.clear();
    currentPage = 1;
    pageCount = await renderer.loadDocument(getSourcePdfBufferCopy());
    await renderCurrentPage();
    updateDocumentMeta();
    setStatus(`Documento cargado: ${sourceFileName}.`);

    const pendingAction = await consumePendingWorkspaceAction(sessionId);
    if (pendingAction) {
      await applyPendingWorkspaceAction(pendingAction);
    }
  } catch (error) {
    renderA4Placeholder();
    void renderPageThumbs();
    updatePageIndicator();
    const message = error instanceof Error ? error.message : "No se pudo abrir el PDF.";
    setStatus(message);
  }
}

function bufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function mergeAdditionalPdfs(files: FileList): Promise<void> {
  if (!files.length) {
    return;
  }

  setStatus("Uniendo PDFs seleccionados...");

  let queue = Array.from(files);
  let baseDoc: PDFDocument;

  if (!sourcePdfBuffer) {
    const firstFile = queue.shift();
    if (!firstFile) {
      return;
    }
    sourceFileName = firstFile.name;
    baseDoc = await PDFDocument.load(await firstFile.arrayBuffer());
  } else {
    baseDoc = await PDFDocument.load(getSourcePdfBufferCopy());
  }

  for (const file of queue) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      continue;
    }

    const extraDoc = await PDFDocument.load(await file.arrayBuffer());
    const pages = await baseDoc.copyPages(extraDoc, extraDoc.getPageIndices());
    pages.forEach((page) => baseDoc.addPage(page));
  }

  const mergedBytes = await baseDoc.save();
  sourcePdfBuffer = new Uint8Array(mergedBytes).buffer;
  pageOverlayState.clear();
  pageThumbnailCache.clear();
  currentPage = 1;
  pageCount = await renderer.loadDocument(getSourcePdfBufferCopy());
  await renderCurrentPage();
  updateDocumentMeta();
  setStatus("Union de PDFs completada.");
}

exportBtn.addEventListener("click", async () => {
  if (!sourcePdfBuffer) {
    setStatus("No hay PDF cargado para exportar.");
    return;
  }

  setStatus("Aplanando anotaciones en el PDF...");

  const blob = await buildFlattenedPdfBlob(true);
  if (!blob) {
    return;
  }

  pendingExportBlob = blob;
  pendingDownloadMode = "export";
  openExportNamePopover();
  setStatus("Define el nombre de exportacion y confirma.");
});

compressBtn.addEventListener("click", () => {
  void compressCurrentPdf();
});

exportCancelBtn.addEventListener("click", () => {
  closeExportNamePopover(true);
  setStatus("Exportacion cancelada por el usuario.");
});

exportConfirmBtn.addEventListener("click", () => {
  downloadPendingExport();
});

exportNameInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    event.preventDefault();
    downloadPendingExport();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeExportNamePopover(true);
  }
});

document.addEventListener("click", (event: MouseEvent) => {
  if (exportNamePopover.hidden) {
    return;
  }

  const target = event.target as Node | null;
  if (!target) {
    return;
  }

  if (exportNamePopover.contains(target) || exportBtn.contains(target) || compressBtn.contains(target)) {
    return;
  }

  closeExportNamePopover(true);
});

mergeBtn.addEventListener("click", () => {
  mergeInput.click();
});

addImageBtn.addEventListener("click", () => {
  toggleToolTab("stamps");
  stampUploadInput.click();
});

addTextBtn.addEventListener("click", () => {
  void (async () => {
    overlay.addText("Nuevo texto");
    await persistCurrentPageOverlay();
    setStatus("Texto agregado. Doble clic para editar contenido.");
  })();
});

editTextBtn.addEventListener("click", () => {
  void (async () => {
    textEditModeEnabled = true;
    await detectEditableTextOnCurrentPage();
  })();
});

deleteObjectBtn.addEventListener("click", () => {
  const removed = overlay.removeActiveObject();
  setStatus(removed ? "Elemento eliminado." : "Selecciona una imagen o texto para eliminar.");
});

mergeInput.addEventListener("change", () => {
  if (!mergeInput.files?.length) {
    return;
  }
  void mergeAdditionalPdfs(mergeInput.files);
});

uploadStampBtn.addEventListener("click", () => {
  stampUploadInput.click();
});

stampUploadInput.addEventListener("change", () => {
  const files = stampUploadInput.files;
  if (files && files.length > 0) {
    void handleStampFiles(files);
  }
  stampUploadInput.value = "";
});

prevPageBtn.addEventListener("click", () => {
  void goToPage(currentPage - 1);
});

nextPageBtn.addEventListener("click", () => {
  void goToPage(currentPage + 1);
});

tabStamps.addEventListener("click", () => {
  toggleToolTab("stamps");
});

if (tabAi) {
  tabAi.addEventListener("click", () => {
    toggleToolTab("ai");
  });
}

document.addEventListener("keydown", (event: KeyboardEvent) => {
  const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
  if (targetTag === "textarea" || targetTag === "input") {
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace" || event.key === "Supr") {
    event.preventDefault();
    const removed = overlay.removeActiveObject();
    if (removed) {
      setStatus("Elemento eliminado del lienzo.");
    } else {
      setStatus("Selecciona una imagen o texto para eliminar.");
    }
  }
});

renderA4Placeholder();
initializePagesSidebarControls();
initializeStampDropzone();
initializeCanvasStampDrop();
initializeCanvasZoom();
initializeCanvasPan();
toggleToolTab("stamps");
closeExportNamePopover(true);
updateDocumentMeta();
void renderPageThumbs();
updatePageIndicator();
void loadStampLibrary();

void loadSessionPdf();
