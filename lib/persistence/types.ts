import type { StoredAgentResult } from "../agent/result";

export type ShipmentLifecycleStatus =
  | "draft"
  | "checking"
  | "action_required"
  | "ready_for_review";

export type DocumentType =
  | "commercial_invoice"
  | "packing_list"
  | "bill_of_lading"
  | "certificate_of_origin"
  | "other";

export type DocumentStatus =
  | "uploaded"
  | "ready"
  | "error"
  | "superseded"
  | "deleted";

export type CheckRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type IssueWorkflowStatus = "open" | "reviewed" | "resolved";

export type IssueResolutionMethod =
  | "recheck_cleared"
  | "recheck_persisted"
  | "accepted_exception";

export type ShipmentRecord = {
  id: string;
  name: string;
  reference: string;
  status: ShipmentLifecycleStatus;
  latestCheckRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShipmentSummary = ShipmentRecord & {
  documentCount: number;
  issueCount: number;
  latestCheck: CheckRunRecord | null;
};

export type DocumentRecord = {
  id: string;
  shipmentId: string;
  documentType: DocumentType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  checksumSha256: string | null;
  version: number;
  status: DocumentStatus;
  replacesDocumentId: string | null;
  uploadedAt: string;
  updatedAt: string;
};

export type CheckRunRecord = {
  id: string;
  shipmentId: string;
  runNumber: number;
  status: CheckRunStatus;
  agentRunId: string | null;
  issueCount: number;
  mustFixCount: number;
  reviewCount: number;
  result: StoredAgentResult | null;
  failure: unknown;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type IssueRecord = {
  id: string;
  shipmentId: string;
  checkRunId: string;
  previousIssueId: string | null;
  resolvedByCheckRunId: string | null;
  fingerprint: string;
  fieldKey: string;
  severity: "review" | "must_fix";
  status: IssueWorkflowStatus;
  needsHumanReview: boolean;
  message: string;
  valuesByDocument: Record<string, unknown>;
  evidenceByDocument: Record<string, unknown>;
  outlierDocumentIds: string[];
  resolutionMethod: IssueResolutionMethod | null;
  resolutionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShipmentDetail = ShipmentSummary & {
  documents: DocumentRecord[];
  checkHistory: CheckRunRecord[];
  issues: IssueRecord[];
};

export type CreateShipmentInput = { name: string; reference?: string };

export type UpdateShipmentInput = Partial<
  Pick<ShipmentRecord, "name" | "reference" | "status" | "latestCheckRunId">
>;

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bill_of_lading: "Bill of Lading",
  certificate_of_origin: "Certificate of Origin",
  other: "Other document",
};

export const SHIPMENT_STATUS_LABELS: Record<ShipmentLifecycleStatus, string> = {
  draft: "Draft",
  checking: "Checking",
  action_required: "Action Required",
  ready_for_review: "Ready for Review",
};

export function inferDocumentType(filename: string): DocumentType {
  const normalized = filename.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(?:commercial )?invoice\b/.test(normalized)) return "commercial_invoice";
  if (/\bpacking (?:list|slip)\b/.test(normalized)) return "packing_list";
  if (/\b(?:bill of lading|bol)\b/.test(normalized)) return "bill_of_lading";
  if (/\b(?:certificate of origin|coo)\b/.test(normalized)) {
    return "certificate_of_origin";
  }
  return "other";
}
