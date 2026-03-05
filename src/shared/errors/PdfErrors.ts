export type PdfErrorCode =
  | "INVALID_FILE"
  | "CORRUPTED_PDF"
  | "PASSWORD_REQUIRED"
  | "MEMORY_LIMIT"
  | "STORAGE_FAILURE"
  | "NETWORK_FAILURE"
  | "UNKNOWN";

export class PdfError extends Error {
  public readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function mapUnknownPdfError(error: unknown): PdfError {
  if (error instanceof PdfError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === "PasswordException") {
      return new PdfError("PASSWORD_REQUIRED", "El PDF requiere contrasena.");
    }
    if (/InvalidPDF|FormatError|UnexpectedResponseException/.test(error.name)) {
      return new PdfError("CORRUPTED_PDF", "El archivo PDF parece estar corrupto.");
    }
    return new PdfError("UNKNOWN", error.message);
  }

  return new PdfError("UNKNOWN", "Ocurrio un error inesperado al procesar el PDF.");
}
