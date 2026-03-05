import { PDFDocument } from "pdf-lib";
import { AIChatClient } from "../services/ai/AIChatClient";
import { PdfTextExtractor } from "../services/ai/PdfTextExtractor";
import type { GetSessionDataRequest, GetSessionDataResponse } from "../shared/messaging/protocol";
import { FabricOverlay, type StampPlacement } from "./canvas/FabricOverlay";
import { PdfFlattenService, type TextPlacement } from "./export/PdfFlattenService";
import { PdfRenderer } from "./render/PdfRenderer";

const pdfCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement;
const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const mergeInput = document.getElementById("merge-input") as HTMLInputElement;
const mergeBtn = document.getElementById("merge-btn") as HTMLButtonElement;
const addImageBtn = document.getElementById("add-image-btn") as HTMLButtonElement;
const addTextBtn = document.getElementById("add-text-btn") as HTMLButtonElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const exportNamePopover = document.getElementById("export-name-popover") as HTMLDivElement;
const exportNameInput = document.getElementById("export-name-input") as HTMLInputElement;
const exportConfirmBtn = document.getElementById("export-confirm-btn") as HTMLButtonElement;
const exportCancelBtn = document.getElementById("export-cancel-btn") as HTMLButtonElement;
const statusEl = document.getElementById("workspace-status") as HTMLParagraphElement;
const docNameEl = document.getElementById("doc-name") as HTMLSpanElement;
const docStatsEl = document.getElementById("doc-stats") as HTMLSpanElement;
const pageListEl = document.getElementById("page-list") as HTMLDivElement;
const pageIndicatorEl = document.getElementById("page-indicator") as HTMLSpanElement;
const prevPageBtn = document.getElementById("prev-page-btn") as HTMLButtonElement;
const nextPageBtn = document.getElementById("next-page-btn") as HTMLButtonElement;
const togglePagesBtn = document.getElementById("toggle-pages-btn") as HTMLButtonElement;
const pagesResizer = document.getElementById("pages-resizer") as HTMLDivElement;
const tabStamps = document.getElementById("tab-stamps") as HTMLButtonElement;
const tabAi = document.getElementById("tab-ai") as HTMLButtonElement;
const stampsPanel = document.getElementById("stamps-panel") as HTMLElement;
const aiPanel = document.getElementById("ai-panel") as HTMLElement;
const uploadStampBtn = document.getElementById("upload-stamp-btn") as HTMLButtonElement;
const stampUploadInput = document.getElementById("stamp-upload-input") as HTMLInputElement;
const stampLibraryEl = document.getElementById("stamp-library") as HTMLDivElement;
const clearAiBtn = document.getElementById("clear-ai-btn") as HTMLButtonElement;
const summarizeAiBtn = document.getElementById("summarize-ai-btn") as HTMLButtonElement;
const askAiBtn = document.getElementById("ask-ai-btn") as HTMLButtonElement;
const questionInput = document.getElementById("question-input") as HTMLTextAreaElement;
const aiMessagesEl = document.getElementById("ai-messages") as HTMLDivElement;

const renderer = new PdfRenderer();
const overlay = new FabricOverlay(overlayCanvas);
const flattenService = new PdfFlattenService();
const textExtractor = new PdfTextExtractor();
const aiClient = new AIChatClient();

const STAMP_LIBRARY_KEY = "stampLibrary";

interface StampLibraryItem {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  bytes: number[];
  createdAt: number;
}

interface AIConfig {
  endpoint: string;
  token: string;
}

let sourcePdfBuffer: ArrayBuffer | null = null;
let sourceFileName = "documento.pdf";
let renderScale = 1.25;
let pageCount = 1;
let currentPage = 1;
let askAiInFlight = false;
let pendingExportBlob: Blob | null = null;
const pageOverlayState = new Map<number, Record<string, unknown>>();
const stampLibrary = new Map<string, StampLibraryItem>();
const pageThumbnailCache = new Map<number, string>();

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

function setStatus(message: string): void {
  statusEl.textContent = message;
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

function getSuggestedExportName(): string {
  const base = sourceFileName.toLowerCase().endsWith(".pdf")
    ? sourceFileName.slice(0, -4)
    : sourceFileName;
  return `${base}_exportado`;
}

function normalizeExportFileName(rawName: string): string {
  const stripped = rawName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ");

  const fallback = getSuggestedExportName();
  const safeBase = stripped.length > 0 ? stripped : fallback;
  return safeBase.toLowerCase().endsWith(".pdf") ? safeBase : `${safeBase}.pdf`;
}

function openExportNamePopover(): void {
  if (!pendingExportBlob) {
    return;
  }

  exportNamePopover.hidden = false;
  exportNameInput.value = getSuggestedExportName();
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
  setStatus(`PDF exportado correctamente como ${finalFileName}.`);
}

function setAskAiBusy(isBusy: boolean): void {
  askAiInFlight = isBusy;
  askAiBtn.disabled = isBusy;
  askAiBtn.textContent = isBusy ? "Consultando..." : "Preguntar";
  questionInput.disabled = isBusy;
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
  if (isArrayBufferLike(value)) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as Uint8Array;
    const copied = new Uint8Array(view.byteLength);
    copied.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copied.buffer;
  }

  if (value && typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    if (Array.isArray(asRecord.data)) {
      return new Uint8Array(asRecord.data as number[]).buffer;
    }

    const numeric = Object.values(asRecord);
    if (numeric.length > 0 && numeric.every((item) => typeof item === "number")) {
      return new Uint8Array(numeric as number[]).buffer;
    }
  }

  throw new Error("Invalid PDF binary data: either TypedArray, string, or array-like object is expected in the data property.");
}

function toggleToolTab(tab: "stamps" | "ai"): void {
  const stampsActive = tab === "stamps";
  tabStamps.classList.toggle("active", stampsActive);
  tabAi.classList.toggle("active", !stampsActive);
  stampsPanel.classList.toggle("active", stampsActive);
  aiPanel.classList.toggle("active", !stampsActive);
}

function appendAiMessage(role: "user" | "bot", message: string): void {
  const item = document.createElement("div");
  item.className = `msg ${role}`;
  item.textContent = message;
  aiMessagesEl.appendChild(item);
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
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

      stampLibraryEl.appendChild(btn);
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
  pageIndicatorEl.textContent = `Pagina ${currentPage} / ${pageCount}`;
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
    .map((obj) => {
      const width = Number(obj.width ?? 0) * Number(obj.scaleX ?? 1);
      const height = Number(obj.height ?? 0) * Number(obj.scaleY ?? 1);
      const fontSize = Number(obj.fontSize ?? 18) * Number(obj.scaleY ?? 1);
      return {
        pageIndex,
        x: Number(obj.left ?? 0),
        y: Number(obj.top ?? 0),
        width,
        height,
        text: String(obj.text ?? ""),
        fontSize,
        colorHex: normalizeColor(obj.fill)
      };
    })
    .filter((item) => Boolean(item.text.trim()));
}

async function renderPageThumbs(): Promise<void> {
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

async function loadSessionPdf(): Promise<void> {
  const sessionId = getSessionId();
  if (!sessionId) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo abrir el PDF.";
    setStatus(message);
  }
}

async function getAIConfig(): Promise<AIConfig> {
  const stored = await chrome.storage.local.get(["aiEndpoint", "aiToken", "aiApiKey"]);
  return {
    endpoint: (stored.aiEndpoint as string) ?? "https://api.company.example/mini-sterling/chat",
    token: (stored.aiToken as string) ?? (stored.aiApiKey as string) ?? ""
  };
}

function bufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function handleStampUpload(): Promise<void> {
  const file = stampUploadInput.files?.[0];
  if (!file) {
    return;
  }

  const buffer = await file.arrayBuffer();
  const id = crypto.randomUUID();
  const item: StampLibraryItem = {
    id,
    name: file.name,
    mimeType: file.type || "image/png",
    dataUrl: bufferToDataUrl(buffer, file.type || "image/png"),
    bytes: Array.from(new Uint8Array(buffer)),
    createdAt: Date.now()
  };

  const existing = Array.from(stampLibrary.values()).find((entry) => entry.dataUrl === item.dataUrl);
  if (existing) {
    await overlay.addStampImage(existing.dataUrl, existing.id);
    setStatus("Esta imagen ya existe en tu biblioteca local. Se reutilizo el sello.");
    return;
  }

  stampLibrary.set(id, item);
  await saveStampLibrary();
  renderStampLibrary();
  await overlay.addStampImage(item.dataUrl, item.id);
  setStatus("Imagen guardada en biblioteca local y aplicada en la pagina actual.");
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

  await persistCurrentPageOverlay();
  const allPlacements: StampPlacement[] = [];
  const allTextPlacements: TextPlacement[] = [];
  pageOverlayState.forEach((serialized, pageNumber) => {
    allPlacements.push(...collectPlacementsFromSerialized(serialized, pageNumber - 1));
    allTextPlacements.push(...collectTextPlacementsFromSerialized(serialized, pageNumber - 1));
  });

  const stampAssets = Array.from(stampLibrary.values()).reduce<Record<string, { bytes: Uint8Array; mimeType: string }>>((acc, item) => {
    acc[item.id] = {
      bytes: new Uint8Array(item.bytes),
      mimeType: item.mimeType
    };
    return acc;
  }, {});

  if (allPlacements.length === 0 && allTextPlacements.length === 0) {
    setStatus("No hay imagenes ni textos colocados para exportar.");
    return;
  }

  const blob = await flattenService.exportDocument({
    sourcePdfBuffer: getSourcePdfBufferCopy(),
    placements: allPlacements,
    stampAssets,
    textPlacements: allTextPlacements,
    renderScale
  });

  pendingExportBlob = blob;
  openExportNamePopover();
  setStatus("Define el nombre de exportacion y confirma.");
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

  if (exportNamePopover.contains(target) || exportBtn.contains(target)) {
    return;
  }

  closeExportNamePopover(true);
});

askAiBtn.addEventListener("click", async () => {
  if (askAiInFlight) {
    return;
  }

  if (!sourcePdfBuffer) {
    setStatus("Carga un PDF antes de usar el asistente IA.");
    return;
  }

  const question = questionInput.value.trim();
  if (!question) {
    setStatus("Escribe una pregunta para el asistente.");
    return;
  }

  appendAiMessage("user", question);
  questionInput.value = "";
  setAskAiBusy(true);

  try {
    const aiConfig = await getAIConfig();
    if (!aiConfig.token) {
      setStatus("Configura aiToken o aiApiKey en ajustes para usar IA.");
      return;
    }

    setStatus("Extrayendo texto del PDF para IA...");
    const text = await textExtractor.extractTextFromPdf(getSourcePdfBufferCopy());

    setStatus("Consultando endpoint IA...");
    const answer = await aiClient.ask({
      endpoint: aiConfig.endpoint,
      authToken: aiConfig.token,
      question,
      documentText: text
    });

    appendAiMessage("bot", answer);
    setStatus("Respuesta IA recibida.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al consultar IA.";
    appendAiMessage("bot", `Error: ${message}`);
    setStatus(message);
  } finally {
    setAskAiBusy(false);
    questionInput.focus();
  }
});

clearAiBtn.addEventListener("click", () => {
  aiMessagesEl.innerHTML = "";
  appendAiMessage("bot", "Chat limpiado. Escribe una nueva consulta sobre el PDF.");
});

summarizeAiBtn.addEventListener("click", () => {
  questionInput.value = "Resume este PDF en 5 puntos accionables.";
  questionInput.focus();
});

mergeBtn.addEventListener("click", () => {
  mergeInput.click();
});

addImageBtn.addEventListener("click", () => {
  stampUploadInput.click();
});

addTextBtn.addEventListener("click", () => {
  overlay.addText("Nuevo texto");
  setStatus("Texto agregado. Haz doble clic para editar contenido.");
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
  void handleStampUpload();
});

questionInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askAiBtn.click();
  }
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

tabAi.addEventListener("click", () => {
  toggleToolTab("ai");
});

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

appendAiMessage("bot", "Hola, soy tu asistente IA. Puedo ayudarte a resumir y analizar este PDF.");

initializePagesSidebarControls();
closeExportNamePopover(true);
updateDocumentMeta();
void loadStampLibrary();

void loadSessionPdf();
