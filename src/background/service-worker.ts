import { mapUnknownPdfError } from "../shared/errors/PdfErrors";
import type {
  GetSessionDataRequest,
  GetSessionDataResponse,
  OpenWorkspaceRequest,
  OpenWorkspaceResponse,
  RuntimeRequest,
  RuntimeResponse,
  SessionPdfRecord
} from "../shared/messaging/protocol";
import { PDFService } from "../services/PDFService";

const sessionStore = new Map<string, SessionPdfRecord>();
const pdfService = new PDFService();

function debugLog(step: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.info(`[MiniSterling][sw] ${step}`, detail);
    return;
  }

  console.info(`[MiniSterling][sw] ${step}`);
}

function createSessionId(): string {
  return crypto.randomUUID();
}

function tryToArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as Uint8Array;
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return bytes.buffer;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.data) && record.data.every((item) => typeof item === "number")) {
      return new Uint8Array(record.data as number[]).buffer;
    }

    const numeric = Object.values(record);
    if (numeric.length > 0 && numeric.every((item) => typeof item === "number")) {
      return new Uint8Array(numeric as number[]).buffer;
    }
  }

  return null;
}

function normalizeIncomingPdfBinary(value: unknown): ArrayBuffer {
  const direct = tryToArrayBuffer(value);
  if (direct) {
    return direct;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedCandidates = [record.arrayBuffer, record.buffer, record.payload, record.pdf, record.binary, record.bytes];
    for (const candidate of nestedCandidates) {
      const normalized = tryToArrayBuffer(candidate);
      if (normalized) {
        return normalized;
      }

      if (candidate && typeof candidate === "object") {
        const deeper = candidate as Record<string, unknown>;
        const deepNormalized = tryToArrayBuffer(deeper.data ?? deeper.arrayBuffer ?? deeper.buffer);
        if (deepNormalized) {
          return deepNormalized;
        }
      }
    }
  }

  const kind = Object.prototype.toString.call(value);
  const keys = value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : [];
  debugLog("normalizeIncomingPdfBinary:failed", { kind, keys });

  throw new Error(`Formato invalido del binario PDF recibido en background (${kind}).`);
}

async function handleOpenWorkspace(msg: OpenWorkspaceRequest): Promise<OpenWorkspaceResponse> {
  debugLog("handleOpenWorkspace:payloadShape", {
    hasPayload: Boolean(msg?.payload),
    payloadKeys: msg?.payload ? Object.keys(msg.payload as unknown as Record<string, unknown>) : []
  });

  const normalizedBuffer = normalizeIncomingPdfBinary(msg.payload.arrayBuffer as unknown);

  debugLog("handleOpenWorkspace:start", {
    fileName: msg.payload.fileName,
    size: normalizedBuffer.byteLength
  });

  const sessionId = createSessionId();
  const stagedHandle = await pdfService.stageArrayBuffer(sessionId, normalizedBuffer);

  sessionStore.set(sessionId, {
    sessionId,
    fileName: msg.payload.fileName,
    stagedHandle
  });

  const workspaceUrl = chrome.runtime.getURL(`workspace.html?sessionId=${encodeURIComponent(sessionId)}`);
  const tab = await chrome.tabs.create({ url: workspaceUrl });

  debugLog("handleOpenWorkspace:tabCreated", {
    sessionId,
    tabId: tab.id,
    mode: stagedHandle.mode
  });

  return {
    ok: true,
    sessionId,
    tabId: tab.id
  };
}

async function handleGetSessionData(msg: GetSessionDataRequest): Promise<GetSessionDataResponse> {
  debugLog("handleGetSessionData:start", msg.payload.sessionId);
  const session = sessionStore.get(msg.payload.sessionId);
  if (!session) {
    debugLog("handleGetSessionData:notFound", msg.payload.sessionId);
    return { ok: false, error: "No se encontro la sesion solicitada." };
  }

  const arrayBuffer = await pdfService.resolveArrayBuffer(session.stagedHandle);
  const safePayload = { data: Array.from(new Uint8Array(arrayBuffer)) };
  debugLog("handleGetSessionData:resolved", {
    sessionId: msg.payload.sessionId,
    size: arrayBuffer.byteLength,
    mode: session.stagedHandle.mode
  });
  return {
    ok: true,
    fileName: session.fileName,
    arrayBuffer: safePayload
  };
}

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  debugLog("onMessage", message.type);
  (async () => {
    try {
      let response: RuntimeResponse;
      if (message.type === "OPEN_WORKSPACE") {
        response = await handleOpenWorkspace(message);
      } else if (message.type === "GET_SESSION_DATA") {
        response = await handleGetSessionData(message);
      } else {
        response = { ok: false, error: "Tipo de mensaje no soportado." };
      }

      sendResponse(response);
    } catch (error: unknown) {
      const mapped = mapUnknownPdfError(error);
      sendResponse({ ok: false, error: mapped.message });
    }
  })();

  return true;
});
