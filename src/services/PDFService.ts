import { PdfError } from "../shared/errors/PdfErrors";
import type { StagedHandle } from "../shared/messaging/protocol";
import { IndexedDbStore } from "./storage/IndexedDbStore";

const DEFAULT_MEMORY_THRESHOLD_MB = 20;

export class PDFService {
  private readonly store = new IndexedDbStore();
  private readonly memoryMap = new Map<string, ArrayBuffer>();
  private readonly thresholdBytes: number;

  constructor(memoryThresholdMb = DEFAULT_MEMORY_THRESHOLD_MB) {
    this.thresholdBytes = memoryThresholdMb * 1024 * 1024;
  }

  readLocalFile(file: File): Promise<ArrayBuffer> {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      throw new PdfError("INVALID_FILE", "Solo se permiten archivos PDF.");
    }

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new PdfError("INVALID_FILE", "No se pudo leer el archivo seleccionado."));
          return;
        }
        resolve(reader.result);
      };
      reader.onerror = () => reject(new PdfError("INVALID_FILE", "Error al leer el archivo PDF."));
      reader.readAsArrayBuffer(file);
    });
  }

  async stageArrayBuffer(key: string, data: ArrayBuffer): Promise<StagedHandle> {
    if (data.byteLength <= this.thresholdBytes) {
      this.memoryMap.set(key, data);
      return { mode: "memory", key };
    }

    await this.store.setArrayBuffer(key, data);
    return { mode: "indexeddb", key };
  }

  async resolveArrayBuffer(handle: StagedHandle): Promise<ArrayBuffer> {
    if (handle.mode === "memory") {
      const value = this.memoryMap.get(handle.key);
      if (!value) {
        throw new PdfError("STORAGE_FAILURE", "No se encontro el documento en memoria.");
      }
      return value;
    }

    const value = await this.store.getArrayBuffer(handle.key);
    if (!value) {
      throw new PdfError("STORAGE_FAILURE", "No se encontro el documento en IndexedDB.");
    }
    return value;
  }
}
