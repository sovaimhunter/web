import type { AgentEvent } from "../agent/types";
import type { DynamicComparison } from "../agent/compare-dynamic";
import type { AgentFailedResult, StoredAgentResult } from "../agent/result";
import type {
  CheckRunRecord,
  CheckRunStatus,
  CreateShipmentInput,
  DocumentRecord,
  DocumentType,
  IssueRecord,
  IssueResolutionMethod,
  IssueWorkflowStatus,
  ShipmentDetail,
  ShipmentLifecycleStatus,
  ShipmentRecord,
  ShipmentSummary,
  UpdateShipmentInput,
} from "./types";

export type CreateDocumentInput = {
  shipmentId: string;
  documentType: DocumentType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  checksumSha256: string;
  version: number;
  replacesDocumentId?: string;
};

export type CompleteCheckInput = {
  checkRunId: string;
  shipmentId: string;
  documentIds: string[];
  result: StoredAgentResult;
  comparison: DynamicComparison;
  events: AgentEvent[];
  status: Extract<CheckRunStatus, "completed" | "partial">;
};

export interface TradeRepository {
  listShipments(): Promise<ShipmentSummary[]>;
  createShipment(input: CreateShipmentInput): Promise<ShipmentRecord>;
  getShipment(id: string): Promise<ShipmentDetail | null>;
  updateShipment(id: string, input: UpdateShipmentInput): Promise<ShipmentRecord>;
  deleteShipment(id: string): Promise<void>;

  listActiveDocuments(shipmentId: string): Promise<DocumentRecord[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  createDocument(input: CreateDocumentInput): Promise<DocumentRecord>;
  supersedeDocument(id: string): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  createCheckRun(shipmentId: string): Promise<CheckRunRecord>;
  setShipmentStatus(
    shipmentId: string,
    status: ShipmentLifecycleStatus,
    latestCheckRunId?: string,
  ): Promise<void>;
  completeCheck(input: CompleteCheckInput): Promise<CheckRunRecord>;
  failCheck(
    checkRunId: string,
    shipmentId: string,
    result: AgentFailedResult,
    events?: AgentEvent[],
  ): Promise<void>;

  updateIssue(
    issueId: string,
    shipmentId: string,
    status: IssueWorkflowStatus,
    input?: {
      note?: string;
      resolutionMethod?: IssueResolutionMethod;
      reviewedBy?: string;
    },
  ): Promise<IssueRecord>;
}
