import type { OpenWorkspaceRequest, OpenWorkspaceResponse } from "../shared/messaging/protocol";
import { PDFService } from "../services/PDFService";
import { IndexedDbStore } from "../services/storage/IndexedDbStore";

const pdfService = new PDFService();
const vaultStore = new IndexedDbStore();

const inputEl = document.getElementById("pdf-input") as HTMLInputElement;
const mergeInputEl = document.getElementById("merge-pdf-input") as HTMLInputElement;
const imageInputEl = document.getElementById("image-input") as HTMLInputElement;
const openButton = document.getElementById("open-workspace") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const welcomeModal = document.getElementById("welcome-modal") as HTMLDivElement;
const termsCheckbox = document.getElementById("terms-checkbox") as HTMLInputElement;
const welcomeDoneButton = document.getElementById("welcome-done") as HTMLButtonElement;
const dropzone = document.getElementById("dropzone") as HTMLElement;
const selectFileBtn = document.getElementById("select-file-btn") as HTMLButtonElement;
const actionImage = document.getElementById("action-image") as HTMLButtonElement;
const actionText = document.getElementById("action-text") as HTMLButtonElement;
const actionMerge = document.getElementById("action-merge") as HTMLButtonElement;
const assistantQuestion = document.getElementById("assistant-question") as HTMLTextAreaElement;
const sendQuestion = document.getElementById("send-question") as HTMLButtonElement;
const assistantBody = document.getElementById("assistant-body") as HTMLDivElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const expandBtn = document.getElementById("expand-btn") as HTMLButtonElement;
const storageBtn = document.getElementById("storage-btn") as HTMLButtonElement;
const settingsModal = document.getElementById("settings-modal") as HTMLDivElement;
const utilityModal = document.getElementById("utility-modal") as HTMLDivElement;
const utilityTitle = document.getElementById("utility-title") as HTMLHeadingElement;
const utilityBody = document.getElementById("utility-body") as HTMLDivElement;
const utilityCloseBtn = document.getElementById("utility-close") as HTMLButtonElement;
const utilityClearBtn = document.getElementById("utility-clear") as HTMLButtonElement;
const endpointInput = document.getElementById("ai-endpoint") as HTMLInputElement;
const apiKeyInput = document.getElementById("ai-apikey") as HTMLInputElement;
const settingsSaveBtn = document.getElementById("settings-save") as HTMLButtonElement;
const settingsCancelBtn = document.getElementById("settings-cancel") as HTMLButtonElement;

const ONBOARDING_KEY = "onboardingCompleted";
const AI_ENDPOINT_KEY = "aiEndpoint";
const AI_APIKEY_KEY = "aiApiKey";
const HISTORY_KEY = "recentWorkspaceHistory";
const WORKSPACE_PENDING_ACTION_KEY = "workspacePendingAction";
const MAX_HISTORY_ITEMS = 15;
let pendingModeAfterPdfPick: Exclude<PopupActionMode, "default" | "merge"> | null = null;

function debugLog(step: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.info(`[MiniSterling][popup] ${step}`, detail);
    return;
  }

  console.info(`[MiniSterling][popup] ${step}`);
}

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

type PopupActionMode = "default" | "merge" | "add-image" | "edit-text";

interface WorkspaceHistoryItem {
  id: string;
  fileName: string;
  mode: PopupActionMode;
  openedAt: number;
  sizeBytes: number;
  vaultKey?: string;
}

interface PendingWorkspaceAction {
  sessionId: string;
  mode: Exclude<PopupActionMode, "default" | "merge">;
  imageDataUrl?: string;
  imageName?: string;
}

const chatHistory: ChatMessage[] = [];

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function openPdfPicker(clearPendingMode: boolean): void {
  if (clearPendingMode) {
    pendingModeAfterPdfPick = null;
  }

  // Ensure change event fires even when selecting the same file again.
  inputEl.value = "";
  inputEl.click();
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatMode(mode: PopupActionMode): string {
  if (mode === "merge") {
    return "Unir PDFs";
  }

  if (mode === "add-image") {
    return "Agregar Imagen";
  }

  if (mode === "edit-text") {
    return "Editar Texto";
  }

  return "Abrir";
}

async function appendHistory(fileName: string, mode: PopupActionMode, arrayBuffer: ArrayBuffer): Promise<void> {
  const id = crypto.randomUUID();
  const vaultKey = `history:${id}`;
  const copied = arrayBuffer.slice(0);
  await vaultStore.setArrayBuffer(vaultKey, copied);

  const stored = await chrome.storage.local.get([HISTORY_KEY]);
  const current = (stored[HISTORY_KEY] as WorkspaceHistoryItem[] | undefined) ?? [];
  const next: WorkspaceHistoryItem[] = [
    {
      id,
      fileName,
      mode,
      sizeBytes: copied.byteLength,
      openedAt: Date.now(),
      vaultKey
    },
    ...current
  ].slice(0, MAX_HISTORY_ITEMS);

  const stale = current.slice(Math.max(0, MAX_HISTORY_ITEMS - 1));
  await Promise.allSettled(
    stale
      .map((item) => item.vaultKey)
      .filter((key): key is string => Boolean(key))
      .map((key) => vaultStore.remove(key))
  );
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

function openUtilityModal(title: string): void {
  utilityTitle.textContent = title;
  utilityModal.classList.remove("hidden");
}

function closeUtilityModal(): void {
  utilityModal.classList.add("hidden");
}

function renderUtilityRows(rows: Array<{ title: string; meta: string }>, emptyText: string): void {
  utilityBody.innerHTML = "";

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "utility-empty";
    empty.textContent = emptyText;
    utilityBody.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "utility-row";

    const title = document.createElement("strong");
    title.textContent = row.title;

    const meta = document.createElement("span");
    meta.textContent = row.meta;

    item.appendChild(title);
    item.appendChild(meta);
    utilityBody.appendChild(item);
  });
}

function createUtilityActionButton(iconName: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "utility-action-btn";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = iconName;
  button.appendChild(icon);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

async function openFromHistory(item: WorkspaceHistoryItem): Promise<void> {
  if (!item.vaultKey) {
    setStatus("Este registro antiguo no tiene archivo recuperable.");
    return;
  }

  const buffer = await vaultStore.getArrayBuffer(item.vaultKey);
  if (!buffer) {
    setStatus("No se encontro el archivo en storage local.");
    return;
  }

  await openWorkspaceFromBuffer(item.fileName, buffer.slice(0), "default");
}

async function downloadFromHistory(item: WorkspaceHistoryItem): Promise<void> {
  if (!item.vaultKey) {
    setStatus("Este registro antiguo no tiene archivo descargable.");
    return;
  }

  const buffer = await vaultStore.getArrayBuffer(item.vaultKey);
  if (!buffer) {
    setStatus("No se encontro el archivo para descargar.");
    return;
  }

  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = item.fileName;
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`Descarga iniciada: ${item.fileName}`);
}

function renderHistoryRows(items: WorkspaceHistoryItem[]): void {
  utilityBody.innerHTML = "";

  if (items.length === 0) {
    renderUtilityRows([], "Aun no hay historial de uso.");
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "utility-row";

    const title = document.createElement("strong");
    title.textContent = `${item.fileName} (${formatMode(item.mode)})`;

    const meta = document.createElement("span");
    const recoverableSuffix = item.vaultKey ? "" : " | sin archivo recuperable";
    meta.textContent = `${formatDate(item.openedAt)} | ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB${recoverableSuffix}`;

    const actions = document.createElement("div");
    actions.className = "utility-actions";
    const hasVault = Boolean(item.vaultKey);
    actions.appendChild(createUtilityActionButton("edit", "Editar / Abrir", () => {
      void openFromHistory(item);
    }, !hasVault));
    actions.appendChild(createUtilityActionButton("download", "Descargar", () => {
      void downloadFromHistory(item);
    }, !hasVault));

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(actions);
    utilityBody.appendChild(row);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function arrayBufferToRuntimePayload(buffer: ArrayBuffer): { data: number[] } {
  return { data: Array.from(new Uint8Array(buffer)) };
}

function appendChatMessage(role: ChatRole, content: string): void {
  chatHistory.push({ role, content });

  const row = document.createElement("div");
  row.className = `assistant-row ${role === "user" ? "assistant-row-user" : "assistant-row-bot"}`;

  if (role === "assistant") {
    const dot = document.createElement("span");
    dot.className = "bot-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = "◉";
    row.appendChild(dot);
  }

  const text = document.createElement("p");
  text.textContent = content;
  row.appendChild(text);

  assistantBody.appendChild(row);
  assistantBody.scrollTop = assistantBody.scrollHeight;
}

function isPdfUrl(url?: string): boolean {
  if (!url) {
    return false;
  }
  const normalized = url.toLowerCase();
  return /\.pdf([?#].*)?$/.test(normalized) || normalized.includes("application/pdf") || normalized.includes("pdfjs") || normalized.includes("/pdf/");
}

async function collectBrowserContext(): Promise<string> {
  const tabs = await chrome.tabs.query({});
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const pdfTabs = tabs.filter((tab) => isPdfUrl(tab.url));

  const activeBlock = activeTab
    ? `Pestana activa: ${activeTab.title ?? "(sin titulo)"}\nURL activa: ${activeTab.url ?? "(sin URL)"}`
    : "Pestana activa: no disponible";

  const pdfBlock = pdfTabs.length > 0
    ? pdfTabs.map((tab, index) => `${index + 1}. ${tab.title ?? "(sin titulo)"} - ${tab.url ?? "(sin URL)"}`).join("\n")
    : "No se detectaron pestanas con PDF.";

  return `${activeBlock}\nTotal de pestanas: ${tabs.length}\nPDFs detectados:\n${pdfBlock}`;
}

async function getAIConfig(): Promise<{ endpoint: string; apiKey: string }> {
  const saved = await chrome.storage.local.get([AI_ENDPOINT_KEY, AI_APIKEY_KEY]);
  return {
    endpoint: (saved[AI_ENDPOINT_KEY] as string) ?? "",
    apiKey: (saved[AI_APIKEY_KEY] as string) ?? ""
  };
}

async function callAI(question: string): Promise<string> {
  const config = await getAIConfig();
  if (!config.endpoint || !config.apiKey) {
    throw new Error("Configura endpoint y API key en Ajustes.");
  }

  const browserContext = await collectBrowserContext();
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      question,
      browserContext,
      history: chatHistory.slice(-8)
    })
  });

  if (!response.ok) {
    throw new Error(`Error del endpoint IA: ${response.status}`);
  }

  const data = await response.json() as { answer?: string; response?: string; message?: string };
  return data.answer ?? data.response ?? data.message ?? "Sin respuesta del servicio IA.";
}

async function openSettings(): Promise<void> {
  const config = await getAIConfig();
  endpointInput.value = config.endpoint;
  apiKeyInput.value = config.apiKey;
  settingsModal.classList.remove("hidden");
}

function closeSettings(): void {
  settingsModal.classList.add("hidden");
}

function setModalVisibility(visible: boolean): void {
  welcomeModal.classList.toggle("hidden", !visible);
  document.body.classList.toggle("onboarding-active", visible);
  inputEl.disabled = visible;
  openButton.disabled = visible;
}

async function initOnboarding(): Promise<void> {
  const stored = await chrome.storage.local.get([ONBOARDING_KEY]);
  const alreadyCompleted = Boolean(stored[ONBOARDING_KEY]);

  if (alreadyCompleted) {
    setModalVisibility(false);
    return;
  }

  setModalVisibility(true);
}

async function openWorkspaceFromBuffer(
  fileName: string,
  arrayBuffer: ArrayBuffer,
  mode: PopupActionMode,
  pendingAction?: PendingWorkspaceAction
): Promise<void> {
  debugLog("openWorkspaceFromBuffer:start", {
    fileName,
    mode,
    size: arrayBuffer.byteLength,
    hasPendingAction: Boolean(pendingAction)
  });

  const historyBuffer = arrayBuffer.slice(0);
  const payloadBuffer = arrayBuffer.slice(0);

  const request: OpenWorkspaceRequest = {
    type: "OPEN_WORKSPACE",
    payload: {
      fileName,
      arrayBuffer: arrayBufferToRuntimePayload(payloadBuffer)
    }
  };

  setStatus("Abriendo mesa de trabajo...");
  let response: OpenWorkspaceResponse;
  try {
    response = await chrome.runtime.sendMessage(request) as OpenWorkspaceResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fallo runtime al enviar OPEN_WORKSPACE.";
    debugLog("openWorkspaceFromBuffer:sendMessageError", message);
    setStatus(message);
    return;
  }

  debugLog("openWorkspaceFromBuffer:response", response);
  if (!response.ok || !response.sessionId) {
    debugLog("openWorkspaceFromBuffer:rejected", {
      ok: response.ok,
      error: response.error
    });
    setStatus(response.error ?? "No se pudo abrir la mesa de trabajo.");
    return;
  }

  if (pendingAction) {
    try {
      await chrome.storage.local.set({
        [WORKSPACE_PENDING_ACTION_KEY]: {
          ...pendingAction,
          sessionId: response.sessionId
        }
      });
      debugLog("openWorkspaceFromBuffer:pendingActionSaved", pendingAction.mode);
    } catch (error) {
      debugLog("openWorkspaceFromBuffer:pendingActionSaveError", error);
    }
  } else {
    try {
      await chrome.storage.local.remove(WORKSPACE_PENDING_ACTION_KEY);
    } catch {
      // Ignore cleanup failures.
    }
  }

  try {
    await appendHistory(fileName, mode, historyBuffer);
    debugLog("openWorkspaceFromBuffer:historySaved");
  } catch (error) {
    debugLog("openWorkspaceFromBuffer:historySaveError", error);
    // History write must never block opening the workspace.
  }

  setStatus("Mesa de trabajo abierta.");
  debugLog("openWorkspaceFromBuffer:closePopup");
  window.close();
}

async function openWorkspace(mode: PopupActionMode = "default"): Promise<void> {
  const file = inputEl.files?.[0];
  if (!file) {
    setStatus("Selecciona un PDF antes de continuar.");
    return;
  }

  debugLog("openWorkspace:start", {
    fileName: file.name,
    size: file.size,
    mode
  });

  setStatus("Leyendo archivo local...");

  try {
    const arrayBuffer = await pdfService.readLocalFile(file);
    if (arrayBuffer.byteLength === 0) {
      setStatus("El PDF seleccionado esta vacio o invalido.");
      return;
    }
    debugLog("openWorkspace:fileReadOk", { bytes: arrayBuffer.byteLength });
    await openWorkspaceFromBuffer(file.name, arrayBuffer, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado al abrir el PDF.";
    debugLog("openWorkspace:error", message);
    setStatus(message);
  }
}

openButton.addEventListener("click", () => {
  void openWorkspace();
});

inputEl.addEventListener("change", () => {
  debugLog("input:change", {
    hasFile: Boolean(inputEl.files?.length),
    pendingModeAfterPdfPick
  });

  if (!inputEl.files?.length) {
    return;
  }

  if (pendingModeAfterPdfPick === "add-image") {
    setStatus("PDF listo. Ahora selecciona la imagen a insertar.");
    pendingModeAfterPdfPick = null;
    imageInputEl.click();
    return;
  }

  if (pendingModeAfterPdfPick === "edit-text") {
    pendingModeAfterPdfPick = null;
    setStatus("Archivo cargado. Activando modo editar texto...");
    actionText.click();
    return;
  }

  setStatus("Archivo cargado. Abriendo mesa de trabajo...");
  void openWorkspace();
});

mergeInputEl.addEventListener("change", () => {
  void (async () => {
    const files = mergeInputEl.files ? Array.from(mergeInputEl.files) : [];
    mergeInputEl.value = "";

    if (files.length < 2) {
      setStatus("Selecciona al menos 2 PDF para unir.");
      return;
    }

    setStatus("Uniendo PDFs seleccionados...");
    try {
      const { PDFDocument } = await import("pdf-lib");
      const baseDoc = await PDFDocument.load(await files[0].arrayBuffer());

      for (const file of files.slice(1)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          continue;
        }

        const extra = await PDFDocument.load(await file.arrayBuffer());
        const pages = await baseDoc.copyPages(extra, extra.getPageIndices());
        pages.forEach((page) => baseDoc.addPage(page));
      }

      const mergedBytes = await baseDoc.save();
      const mergedName = files[0].name.toLowerCase().endsWith(".pdf")
        ? `${files[0].name.slice(0, -4)}_unido.pdf`
        : `${files[0].name}_unido.pdf`;

      await openWorkspaceFromBuffer(mergedName, new Uint8Array(mergedBytes).buffer, "merge");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron unir los PDFs.";
      setStatus(message);
    }
  })();
});

imageInputEl.addEventListener("change", () => {
  void (async () => {
    const imageFile = imageInputEl.files?.[0];
    imageInputEl.value = "";

    if (!imageFile) {
      return;
    }

    const pdfFile = inputEl.files?.[0];
    if (!pdfFile) {
      setStatus("Primero selecciona un PDF para agregar la imagen.");
      inputEl.click();
      return;
    }

    try {
      const pdfBuffer = await pdfService.readLocalFile(pdfFile);
      const imageBuffer = await imageFile.arrayBuffer();
      const imageDataUrl = `data:${imageFile.type || "image/png"};base64,${arrayBufferToBase64(imageBuffer)}`;

      await openWorkspaceFromBuffer(pdfFile.name, pdfBuffer, "add-image", {
        sessionId: "",
        mode: "add-image",
        imageDataUrl,
        imageName: imageFile.name
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar Agregar Imagen.";
      setStatus(message);
    }
  })();
});

dropzone.addEventListener("click", () => {
  openPdfPicker(true);
});

selectFileBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openPdfPicker(true);
});

dropzone.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openPdfPicker(true);
  }
});

dropzone.addEventListener("dragover", (event: DragEvent) => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (event: DragEvent) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  pendingModeAfterPdfPick = null;

  const files = event.dataTransfer?.files;
  const file = files && files.length > 0 ? files[0] : null;
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Solo se permiten archivos PDF.");
    return;
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  inputEl.files = dt.files;
  void openWorkspace();
});

actionMerge.addEventListener("click", () => {
  mergeInputEl.click();
});

actionImage.addEventListener("click", () => {
  if (!inputEl.files?.length) {
    setStatus("Selecciona un PDF y luego agrega una imagen.");
    pendingModeAfterPdfPick = "add-image";
    openPdfPicker(false);
    return;
  }

  imageInputEl.click();
});

actionText.addEventListener("click", () => {
  void (async () => {
    const pdfFile = inputEl.files?.[0];
    if (!pdfFile) {
      setStatus("Selecciona un PDF para habilitar edicion de texto.");
      pendingModeAfterPdfPick = "edit-text";
      openPdfPicker(false);
      return;
    }

    try {
      const pdfBuffer = await pdfService.readLocalFile(pdfFile);
      await openWorkspaceFromBuffer(pdfFile.name, pdfBuffer, "edit-text", {
        sessionId: "",
        mode: "edit-text"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar Editar Texto.";
      setStatus(message);
    }
  })();
});

sendQuestion.addEventListener("click", () => {
  void (async () => {
    const value = assistantQuestion.value.trim();
    if (!value) {
      setStatus("Escribe una pregunta para continuar.");
      return;
    }

    appendChatMessage("user", value);
    assistantQuestion.value = "";
    setStatus("Consultando IA con contexto del navegador...");

    try {
      const answer = await callAI(value);
      appendChatMessage("assistant", answer);
      setStatus("Respuesta recibida.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo completar la consulta IA.";
      appendChatMessage("assistant", `Error: ${message}`);
      setStatus(message);
    }
  })();
});

settingsBtn.addEventListener("click", () => {
  void openSettings();
});

settingsSaveBtn.addEventListener("click", () => {
  void (async () => {
    await chrome.storage.local.set({
      [AI_ENDPOINT_KEY]: endpointInput.value.trim(),
      [AI_APIKEY_KEY]: apiKeyInput.value.trim()
    });
    closeSettings();
    setStatus("Configuracion IA guardada.");
  })();
});

settingsCancelBtn.addEventListener("click", () => {
  closeSettings();
});

expandBtn.addEventListener("click", () => {
  void (async () => {
    const stored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = (stored[HISTORY_KEY] as WorkspaceHistoryItem[] | undefined) ?? [];
    renderHistoryRows(history);
    openUtilityModal("Historial");
  })();
});

storageBtn.addEventListener("click", () => {
  void (async () => {
    const stored = await chrome.storage.local.get(null);
    const stampCount = Array.isArray(stored.stampLibrary) ? (stored.stampLibrary as unknown[]).length : 0;
    const hasAi = Boolean(stored[AI_ENDPOINT_KEY]) && Boolean(stored[AI_APIKEY_KEY]);
    const onboarding = Boolean(stored[ONBOARDING_KEY]);

    renderUtilityRows(
      [
        {
          title: `Sellos guardados: ${stampCount}`,
          meta: "Biblioteca local en chrome.storage.local"
        },
        {
          title: `Configuracion IA: ${hasAi ? "lista" : "pendiente"}`,
          meta: "Endpoint/API Key"
        },
        {
          title: `Onboarding: ${onboarding ? "completado" : "pendiente"}`,
          meta: "Estado de bienvenida"
        }
      ],
      "No hay datos de storage."
    );
    openUtilityModal("Storage");
  })();
});

utilityCloseBtn.addEventListener("click", () => {
  closeUtilityModal();
});

utilityClearBtn.addEventListener("click", () => {
  void (async () => {
    if (utilityTitle.textContent === "Historial") {
      const stored = await chrome.storage.local.get([HISTORY_KEY]);
      const history = (stored[HISTORY_KEY] as WorkspaceHistoryItem[] | undefined) ?? [];
      await Promise.allSettled(
        history
          .map((item) => item.vaultKey)
          .filter((key): key is string => Boolean(key))
          .map((key) => vaultStore.remove(key))
      );
      await chrome.storage.local.remove(HISTORY_KEY);
      renderHistoryRows([]);
      setStatus("Historial limpiado.");
      return;
    }

    await chrome.storage.local.remove(["stampLibrary", HISTORY_KEY]);
    renderUtilityRows([], "Storage limpiado.");
    setStatus("Storage local limpiado (sellos e historial).");
  })();
});

assistantQuestion.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendQuestion.click();
  }
});

termsCheckbox.addEventListener("change", () => {
  welcomeDoneButton.disabled = !termsCheckbox.checked;
});

welcomeDoneButton.addEventListener("click", () => {
  void (async () => {
    await chrome.storage.local.set({
      [ONBOARDING_KEY]: true,
      onboardingAcceptedAt: Date.now()
    });
    setModalVisibility(false);
    setStatus("Listo. Ya puedes cargar tu PDF.");
  })();
});

void initOnboarding();
