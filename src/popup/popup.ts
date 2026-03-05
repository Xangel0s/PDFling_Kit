import type { OpenWorkspaceRequest, OpenWorkspaceResponse } from "../shared/messaging/protocol";
import { PDFService } from "../services/PDFService";

const pdfService = new PDFService();

const inputEl = document.getElementById("pdf-input") as HTMLInputElement;
const openButton = document.getElementById("open-workspace") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const welcomeModal = document.getElementById("welcome-modal") as HTMLDivElement;
const termsCheckbox = document.getElementById("terms-checkbox") as HTMLInputElement;
const welcomeDoneButton = document.getElementById("welcome-done") as HTMLButtonElement;
const dropzone = document.getElementById("dropzone") as HTMLElement;
const actionSign = document.getElementById("action-sign") as HTMLButtonElement;
const actionAsk = document.getElementById("action-ask") as HTMLButtonElement;
const actionMerge = document.getElementById("action-merge") as HTMLButtonElement;
const assistantQuestion = document.getElementById("assistant-question") as HTMLTextAreaElement;
const sendQuestion = document.getElementById("send-question") as HTMLButtonElement;
const assistantBody = document.getElementById("assistant-body") as HTMLDivElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const expandBtn = document.getElementById("expand-btn") as HTMLButtonElement;
const settingsModal = document.getElementById("settings-modal") as HTMLDivElement;
const endpointInput = document.getElementById("ai-endpoint") as HTMLInputElement;
const apiKeyInput = document.getElementById("ai-apikey") as HTMLInputElement;
const settingsSaveBtn = document.getElementById("settings-save") as HTMLButtonElement;
const settingsCancelBtn = document.getElementById("settings-cancel") as HTMLButtonElement;

const ONBOARDING_KEY = "onboardingCompleted";
const AI_ENDPOINT_KEY = "aiEndpoint";
const AI_APIKEY_KEY = "aiApiKey";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const chatHistory: ChatMessage[] = [];

function setStatus(message: string): void {
  statusEl.textContent = message;
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

async function openWorkspace(): Promise<void> {
  const file = inputEl.files?.[0];
  if (!file) {
    setStatus("Selecciona un PDF antes de continuar.");
    return;
  }

  setStatus("Leyendo archivo local...");

  try {
    const arrayBuffer = await pdfService.readLocalFile(file);
    const request: OpenWorkspaceRequest = {
      type: "OPEN_WORKSPACE",
      payload: {
        fileName: file.name,
        arrayBuffer
      }
    };

    setStatus("Abriendo mesa de trabajo...");

    const response = await chrome.runtime.sendMessage(request) as OpenWorkspaceResponse;
    if (!response.ok) {
      setStatus(response.error ?? "No se pudo abrir la mesa de trabajo.");
      return;
    }

    setStatus("Mesa de trabajo abierta.");
    window.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado al abrir el PDF.";
    setStatus(message);
  }
}

openButton.addEventListener("click", () => {
  void openWorkspace();
});

inputEl.addEventListener("change", () => {
  if (!inputEl.files?.length) {
    return;
  }
  setStatus("Archivo cargado. Abriendo mesa de trabajo...");
  void openWorkspace();
});

dropzone.addEventListener("click", () => {
  inputEl.click();
});

dropzone.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    inputEl.click();
  }
});

actionSign.addEventListener("click", () => {
  inputEl.click();
});

actionAsk.addEventListener("click", () => {
  assistantQuestion.focus();
});

actionMerge.addEventListener("click", () => {
  inputEl.click();
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
  const url = chrome.runtime.getURL("workspace.html");
  void chrome.tabs.create({ url });
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
