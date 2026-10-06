import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentFailedResult } from "../agent/result";
import type { AgentEvent } from "../agent/types";
import type {
  CheckRunRecord,
  DocumentRecord,
  IssueRecord,
  ShipmentDetail,
  ShipmentRecord,
  ShipmentSummary,
} from "./types";
import type {
  CompleteCheckInput,
  CreateDocumentInput,
  TradeRepository,
} from "./repository";
import type {
  CreateShipmentInput,
  IssueResolutionMethod,
  IssueWorkflowStatus,
  ShipmentLifecycleStatus,
  UpdateShipmentInput,
} from "./types";

type Row = Record<string, unknown>;

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function shipment(row: Row): ShipmentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    reference: String(row.reference ?? ""),
    status: row.status as ShipmentRecord["status"],
    latestCheckRunId: row.latest_check_run_id
      ? String(row.latest_check_run_id)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function document(row: Row): DocumentRecord {
  return {
    id: String(row.id),
    shipmentId: String(row.shipment_id),
    documentType: row.document_type as DocumentRecord["documentType"],
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storagePath: String(row.storage_path),
    checksumSha256: row.checksum_sha256 ? String(row.checksum_sha256) : null,
    version: Number(row.version),
    status: row.status as DocumentRecord["status"],
    replacesDocumentId: row.replaces_document_id
      ? String(row.replaces_document_id)
      : null,
    uploadedAt: String(row.uploaded_at),
    updatedAt: String(row.updated_at),
  };
}

function checkRun(row: Row): CheckRunRecord {
  return {
    id: String(row.id),
    shipmentId: String(row.shipment_id),
    runNumber: Number(row.run_number),
    status: row.status as CheckRunRecord["status"],
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : null,
    issueCount: Number(row.issue_count ?? 0),
    mustFixCount: Number(row.must_fix_count ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    result: (row.result as CheckRunRecord["result"]) ?? null,
    failure: row.failure ?? null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
  };
}

function issue(row: Row): IssueRecord {
  return {
    id: String(row.id),
    shipmentId: String(row.shipment_id),
    checkRunId: String(row.check_run_id),
    previousIssueId: row.previous_issue_id ? String(row.previous_issue_id) : null,
    resolvedByCheckRunId: row.resolved_by_check_run_id
      ? String(row.resolved_by_check_run_id)
      : null,
    fingerprint: String(row.fingerprint),
    fieldKey: String(row.field_key),
    severity: row.severity as IssueRecord["severity"],
    status: row.status as IssueRecord["status"],
    needsHumanReview: Boolean(row.needs_human_review),
    message: String(row.message),
    valuesByDocument: (row.values_by_document as Record<string, unknown>) ?? {},
    evidenceByDocument:
      (row.evidence_by_document as Record<string, unknown>) ?? {},
    outlierDocumentIds: (row.outlier_document_ids as string[]) ?? [],
    resolutionMethod:
      (row.resolution_method as IssueRecord["resolutionMethod"]) ?? null,
    resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function fingerprint(field: string, outliers: string[]): string {
  return createHash("sha256")
    .update(`${field}:${[...outliers].sort().join(",")}`)
    .digest("hex");
}

export class SupabaseTradeRepository implements TradeRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async saveAgentEvents(
    checkRunId: string,
    events: AgentEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    const { error } = await this.db.from("agent_run_events").insert(
      events.map((event) => ({
        check_run_id: checkRunId,
        run_id: event.runId,
        sequence: event.sequence,
        event_type: event.type,
        payload: event,
        occurred_at: new Date(event.timestamp).toISOString(),
      })),
    );
    fail(error);
  }

  async listShipments(): Promise<ShipmentSummary[]> {
    const { data, error } = await this.db
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false });
    fail(error);
    const records = (data ?? []).map((row) => shipment(row as Row));
    return Promise.all(
      records.map(async (record) => {
        const detail = await this.getShipment(record.id);
        if (!detail) throw new Error(`Shipment ${record.id} disappeared`);
        return detail;
      }),
    );
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentRecord> {
    const { data, error } = await this.db
      .from("shipments")
      .insert({ name: input.name.trim(), reference: input.reference?.trim() ?? "" })
      .select("*")
      .single();
    fail(error);
    return shipment(data as Row);
  }

  async getShipment(id: string): Promise<ShipmentDetail | null> {
    const { data, error } = await this.db
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    fail(error);
    if (!data) return null;
    const [documents, runsResult, issuesResult] = await Promise.all([
      this.listActiveDocuments(id),
      this.db
        .from("check_runs")
        .select("*")
        .eq("shipment_id", id)
        .order("run_number", { ascending: false }),
      this.db
        .from("issues")
        .select("*")
        .eq("shipment_id", id)
        .order("created_at", { ascending: false }),
    ]);
    fail(runsResult.error);
    fail(issuesResult.error);
    const checkHistory = (runsResult.data ?? []).map((row) => checkRun(row as Row));
    const issues = (issuesResult.data ?? []).map((row) => issue(row as Row));
    const base = shipment(data as Row);
    return {
      ...base,
      documentCount: documents.length,
      issueCount: issues.filter((value) => value.status !== "resolved").length,
      latestCheck: checkHistory[0] ?? null,
      documents,
      checkHistory,
      issues,
    };
  }

  async updateShipment(id: string, input: UpdateShipmentInput): Promise<ShipmentRecord> {
    const patch: Row = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.reference !== undefined) patch.reference = input.reference.trim();
    if (input.status !== undefined) patch.status = input.status;
    if (input.latestCheckRunId !== undefined) {
      patch.latest_check_run_id = input.latestCheckRunId;
    }
    const { data, error } = await this.db
      .from("shipments")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    fail(error);
    return shipment(data as Row);
  }

  async deleteShipment(id: string): Promise<void> {
    const { data: storedDocuments, error: documentsError } = await this.db
      .from("documents")
      .select("storage_path")
      .eq("shipment_id", id);
    fail(documentsError);
    const storagePaths = (storedDocuments ?? []).map((value) =>
      String(value.storage_path),
    );
    if (storagePaths.length > 0) {
      const { error: storageError } = await this.db.storage
        .from("shipment-documents")
        .remove(storagePaths);
      fail(storageError);
    }
    const { error } = await this.db.from("shipments").delete().eq("id", id);
    fail(error);
  }

  async listActiveDocuments(shipmentId: string): Promise<DocumentRecord[]> {
    const { data, error } = await this.db
      .from("documents")
      .select("*")
      .eq("shipment_id", shipmentId)
      .in("status", ["uploaded", "ready", "error"])
      .order("uploaded_at", { ascending: true });
    fail(error);
    return (data ?? []).map((row) => document(row as Row));
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.db
      .from("documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    fail(error);
    return data ? document(data as Row) : null;
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    const { data, error } = await this.db
      .from("documents")
      .insert({
        shipment_id: input.shipmentId,
        document_type: input.documentType,
        original_name: input.originalName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        storage_path: input.storagePath,
        checksum_sha256: input.checksumSha256,
        version: input.version,
        status: "ready",
        replaces_document_id: input.replacesDocumentId ?? null,
      })
      .select("*")
      .single();
    fail(error);
    return document(data as Row);
  }

  async supersedeDocument(id: string): Promise<void> {
    const { error } = await this.db
      .from("documents")
      .update({ status: "superseded" })
      .eq("id", id);
    fail(error);
  }

  async deleteDocument(id: string): Promise<void> {
    const value = await this.getDocument(id);
    if (!value) return;
    const { error: storageError } = await this.db.storage
      .from("shipment-documents")
      .remove([value.storagePath]);
    fail(storageError);
    const { error } = await this.db
      .from("documents")
      .update({ status: "deleted", deleted_at: new Date().toISOString() })
      .eq("id", id);
    fail(error);
  }

  async createCheckRun(shipmentId: string): Promise<CheckRunRecord> {
    const { data: latest, error: latestError } = await this.db
      .from("check_runs")
      .select("run_number")
      .eq("shipment_id", shipmentId)
      .order("run_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    fail(latestError);
    const { data, error } = await this.db
      .from("check_runs")
      .insert({
        shipment_id: shipmentId,
        run_number: Number(latest?.run_number ?? 0) + 1,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    fail(error);
    return checkRun(data as Row);
  }

  async setShipmentStatus(
    shipmentId: string,
    status: ShipmentLifecycleStatus,
    latestCheckRunId?: string,
  ): Promise<void> {
    const patch: Row = { status };
    if (latestCheckRunId !== undefined) patch.latest_check_run_id = latestCheckRunId;
    const { error } = await this.db
      .from("shipments")
      .update(patch)
      .eq("id", shipmentId);
    fail(error);
  }

  async completeCheck(input: CompleteCheckInput): Promise<CheckRunRecord> {
    const now = new Date().toISOString();
    const issues = input.comparison.issues;
    const mustFixCount = issues.filter((value) => value.status === "must_fix").length;
    const reviewCount = issues.filter((value) => value.status === "review").length;

    const links = input.documentIds.map((documentId) => ({
      check_run_id: input.checkRunId,
      document_id: documentId,
    }));
    if (links.length > 0) {
      const { error } = await this.db.from("check_run_documents").insert(links);
      fail(error);
    }

    const extractedRows = input.comparison.documents.flatMap((doc) =>
      Object.entries({ ...doc.fields, ...doc.extra })
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([field, value]) => {
          const evidence = doc.evidence?.[field];
          return {
            check_run_id: input.checkRunId,
            document_id: doc.id,
            field_key: field,
            normalized_value: value,
            raw_value: evidence?.rawValue ?? null,
            page_number: evidence?.page ?? null,
            source_quote: evidence?.quote ?? null,
            source_unit: evidence?.unit ?? null,
            confidence: evidence?.confidence ?? null,
          };
        }),
    );
    if (extractedRows.length > 0) {
      const { error } = await this.db.from("extracted_fields").insert(extractedRows);
      fail(error);
    }

    const validationRows = input.comparison.rows.map((row) => ({
      check_run_id: input.checkRunId,
      field_key: row.field,
      field_kind: row.kind,
      status: row.status,
      values_by_document: row.values,
      outlier_document_ids: row.outliers,
      reference_value: row.reference ?? null,
    }));
    const validationByField = new Map<string, string>();
    if (validationRows.length > 0) {
      const { data, error } = await this.db
        .from("validation_results")
        .insert(validationRows)
        .select("id,field_key");
      fail(error);
      for (const row of data ?? []) {
        validationByField.set(String(row.field_key), String(row.id));
      }
    }

    const { data: previousIssues, error: previousError } = await this.db
      .from("issues")
      .select("id,fingerprint")
      .eq("shipment_id", input.shipmentId)
      .in("status", ["open", "reviewed"])
      .order("created_at", { ascending: false });
    fail(previousError);
    const previousByFingerprint = new Map<string, string>();
    for (const row of previousIssues ?? []) {
      const key = String(row.fingerprint);
      if (!previousByFingerprint.has(key)) previousByFingerprint.set(key, String(row.id));
    }
    const currentFingerprints = new Set(
      issues.map((value) => fingerprint(value.field, value.outliers)),
    );
    const recurringIds = (previousIssues ?? [])
      .filter((row) => currentFingerprints.has(String(row.fingerprint)))
      .map((row) => String(row.id));
    const clearedIds = (previousIssues ?? [])
      .filter((row) => !currentFingerprints.has(String(row.fingerprint)))
      .map((row) => String(row.id));

    const resolvePrevious = async (
      ids: string[],
      resolutionMethod: Extract<
        IssueResolutionMethod,
        "recheck_cleared" | "recheck_persisted"
      >,
    ) => {
      if (ids.length === 0) return;
      const { error } = await this.db
        .from("issues")
        .update({
          status: "resolved",
          resolution_method: resolutionMethod,
          resolved_at: now,
          resolved_by_check_run_id: input.checkRunId,
        })
        .in("id", ids);
      fail(error);
    };
    await resolvePrevious(clearedIds, "recheck_cleared");
    await resolvePrevious(recurringIds, "recheck_persisted");

    const issueRows = issues.map((value) => {
      const key = fingerprint(value.field, value.outliers);
      return {
        shipment_id: input.shipmentId,
        check_run_id: input.checkRunId,
        validation_result_id: validationByField.get(value.field) ?? null,
        previous_issue_id: previousByFingerprint.get(key) ?? null,
        fingerprint: key,
        field_key: value.field,
        severity: value.status,
        status: "open",
        needs_human_review: value.needsHumanReview,
        message: value.message,
        values_by_document: value.values,
        evidence_by_document: value.evidence ?? {},
        outlier_document_ids: value.outliers,
      };
    });
    if (issueRows.length > 0) {
      const { error } = await this.db.from("issues").insert(issueRows);
      fail(error);
    }

    await this.saveAgentEvents(input.checkRunId, input.events);

    const agentRunId = input.events[0]?.runId ?? null;
    const { data, error } = await this.db
      .from("check_runs")
      .update({
        status: input.status,
        agent_run_id: agentRunId,
        issue_count: issues.length,
        must_fix_count: mustFixCount,
        review_count: reviewCount,
        result: input.result,
        completed_at: now,
      })
      .eq("id", input.checkRunId)
      .select("*")
      .single();
    fail(error);
    await this.setShipmentStatus(
      input.shipmentId,
      issues.length > 0 ? "action_required" : "ready_for_review",
      input.checkRunId,
    );
    return checkRun(data as Row);
  }

  async failCheck(
    checkRunId: string,
    shipmentId: string,
    result: AgentFailedResult,
    events: AgentEvent[] = [],
  ): Promise<void> {
    await this.saveAgentEvents(checkRunId, events);
    const agentRunId = events[0]?.runId ?? null;
    const { error } = await this.db
      .from("check_runs")
      .update({
        status: "failed",
        agent_run_id: agentRunId,
        failure: result.failures,
        result,
        completed_at: new Date().toISOString(),
      })
      .eq("id", checkRunId);
    fail(error);
    await this.setShipmentStatus(shipmentId, "draft");
  }

  async updateIssue(
    issueId: string,
    shipmentId: string,
    status: IssueWorkflowStatus,
    input: {
      note?: string;
      resolutionMethod?: IssueResolutionMethod;
      reviewedBy?: string;
    } = {},
  ): Promise<IssueRecord> {
    const now = new Date().toISOString();
    const patch: Row = {
      status,
      resolution_note: input.note?.trim() || null,
      resolution_method: input.resolutionMethod ?? null,
      reviewed_by: input.reviewedBy ?? null,
      reviewed_at: status === "reviewed" || status === "resolved" ? now : null,
      resolved_at: status === "resolved" ? now : null,
    };
    const { data, error } = await this.db
      .from("issues")
      .update(patch)
      .eq("id", issueId)
      .eq("shipment_id", shipmentId)
      .select("*")
      .single();
    fail(error);
    const updated = issue(data as Row);
    if (status === "resolved") {
      const { count, error: countError } = await this.db
        .from("issues")
        .select("id", { count: "exact", head: true })
        .eq("check_run_id", updated.checkRunId)
        .neq("status", "resolved");
      fail(countError);
      await this.setShipmentStatus(
        shipmentId,
        (count ?? 0) > 0 ? "action_required" : "ready_for_review",
      );
    }
    return updated;
  }
}

export function getTradeRepository(db: SupabaseClient): TradeRepository {
  return new SupabaseTradeRepository(db);
}
