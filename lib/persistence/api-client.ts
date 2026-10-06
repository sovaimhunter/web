"use client";

import type {
  CheckRunRecord,
  DocumentRecord,
  DocumentType,
  IssueRecord,
  IssueResolutionMethod,
  IssueWorkflowStatus,
  ShipmentDetail,
  ShipmentRecord,
  ShipmentSummary,
} from "./types";
import type { AgentCheckResult, AgentFailedResult } from "../agent/result";
import { getAccessToken } from "./supabase-browser";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const shipmentApi = {
  list: () => api<ShipmentSummary[]>("/api/shipments"),
  get: (id: string) => api<ShipmentDetail>(`/api/shipments/${id}`),
  create: (input: { name: string; reference: string }) =>
    api<ShipmentRecord>("/api/shipments", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: { name?: string; reference?: string }) =>
    api<ShipmentRecord>(`/api/shipments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  delete: (id: string) =>
    api<void>(`/api/shipments/${id}`, { method: "DELETE" }),
};

export async function uploadDocument(input: {
  shipmentId: string;
  file: File;
  documentType?: DocumentType;
  replaceDocumentId?: string;
}): Promise<DocumentRecord> {
  const body = new FormData();
  body.set("file", input.file, input.file.name);
  if (input.documentType) body.set("documentType", input.documentType);
  if (input.replaceDocumentId) body.set("replaceDocumentId", input.replaceDocumentId);
  return api<DocumentRecord>(`/api/shipments/${input.shipmentId}/documents`, {
    method: "POST",
    body,
  });
}

export function deleteDocument(
  shipmentId: string,
  documentId: string,
): Promise<void> {
  return api<void>(`/api/shipments/${shipmentId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

export function updateIssue(input: {
  shipmentId: string;
  issueId: string;
  status: IssueWorkflowStatus;
  note?: string;
  resolutionMethod?: IssueResolutionMethod;
}): Promise<IssueRecord> {
  return api<IssueRecord>(
    `/api/shipments/${input.shipmentId}/issues/${input.issueId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: input.status,
        note: input.note,
        resolutionMethod: input.resolutionMethod,
      }),
    },
  );
}

export function persistCheck(input: {
  shipmentId: string;
  result: AgentCheckResult | AgentFailedResult;
  documentIds: Record<string, string>;
}): Promise<{ result: AgentCheckResult | AgentFailedResult }> {
  return api(`/api/shipments/${input.shipmentId}/checks`, {
    method: "POST",
    body: JSON.stringify({ result: input.result, documentIds: input.documentIds }),
  });
}

export function runShipmentCheck(
  shipmentId: string,
): Promise<{
  run?: CheckRunRecord;
  runId?: string;
  result: AgentCheckResult | AgentFailedResult;
}> {
  return api(`/api/shipments/${shipmentId}/run-check`, { method: "POST" });
}
