export type StagedHandle =
  | { mode: "memory"; key: string }
  | { mode: "indexeddb"; key: string };

export interface OpenWorkspaceRequest {
  type: "OPEN_WORKSPACE";
  payload: {
    fileName: string;
    arrayBuffer: ArrayBuffer | { data: number[] } | number[] | Record<string, unknown>;
  };
}

export interface OpenWorkspaceResponse {
  ok: boolean;
  sessionId?: string;
  tabId?: number;
  error?: string;
}

export interface GetSessionDataRequest {
  type: "GET_SESSION_DATA";
  payload: {
    sessionId: string;
  };
}

export interface GetSessionDataResponse {
  ok: boolean;
  fileName?: string;
  arrayBuffer?: ArrayBuffer | { data: number[] } | number[] | Record<string, unknown>;
  error?: string;
}

export interface SessionPdfRecord {
  sessionId: string;
  fileName: string;
  stagedHandle: StagedHandle;
}

export type RuntimeRequest = OpenWorkspaceRequest | GetSessionDataRequest;
export type RuntimeResponse = OpenWorkspaceResponse | GetSessionDataResponse;
