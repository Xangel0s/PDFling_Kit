import { PdfError } from "../../shared/errors/PdfErrors";

export interface AIChatRequest {
  endpoint: string;
  authToken: string;
  question: string;
  documentText: string;
}

export class AIChatClient {
  async ask(request: AIChatRequest): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(request.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.authToken}`
        },
        body: JSON.stringify({
          question: request.question,
          context: request.documentText
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new PdfError("NETWORK_FAILURE", `Error del endpoint IA: ${response.status}`);
      }

      const payload = await response.json() as { answer?: string };
      return payload.answer ?? "No se recibio respuesta del servicio IA.";
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
