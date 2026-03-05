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

function createSessionId(): string {
  return crypto.randomUUID();
}

async function handleOpenWorkspace(msg: OpenWorkspaceRequest): Promise<OpenWorkspaceResponse> {
  const sessionId = createSessionId();
  const stagedHandle = await pdfService.stageArrayBuffer(sessionId, msg.payload.arrayBuffer);

  sessionStore.set(sessionId, {
    sessionId,
    fileName: msg.payload.fileName,
    stagedHandle
  });

  const workspaceUrl = chrome.runtime.getURL(`workspace.html?sessionId=${encodeURIComponent(sessionId)}`);
  const tab = await chrome.tabs.create({ url: workspaceUrl });

  return {
    ok: true,
    sessionId,
    tabId: tab.id
  };
}

async function handleGetSessionData(msg: GetSessionDataRequest): Promise<GetSessionDataResponse> {
  const session = sessionStore.get(msg.payload.sessionId);
  if (!session) {
    return { ok: false, error: "No se encontro la sesion solicitada." };
  }

  const arrayBuffer = await pdfService.resolveArrayBuffer(session.stagedHandle);
  return {
    ok: true,
    fileName: session.fileName,
    arrayBuffer
  };
}

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
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
