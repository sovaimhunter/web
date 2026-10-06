import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicComparison } from "../../lib/agent/compare-dynamic";
import type { AgentEvent } from "../../lib/agent/types";
import type { ShipmentDetail } from "../../lib/persistence/types";

const mocks = vi.hoisted(() => ({
  persistenceContext: vi.fn(),
  loadCatalog: vi.fn(() => ({ version: 1, fields: {}, crossFieldRules: [] })),
  runFileConsistency: vi.fn(),
}));

vi.mock("@/lib/persistence/context", () => ({
  persistenceContext: mocks.persistenceContext,
}));
vi.mock("@/lib/agent/catalog-file", () => ({
  loadDocumentConsistencyCatalog: mocks.loadCatalog,
}));
vi.mock("@/lib/agent/pi/runtime", () => ({
  runFileConsistency: mocks.runFileConsistency,
}));

import { POST } from "../../app/api/shipments/[id]/run-check/route";

const comparison: DynamicComparison = {
  documents: [],
  issues: [],
  rows: [],
  requiresHumanReview: false,
};

const runStarted: AgentEvent = {
  type: "run_started",
  runId: "11111111-1111-4111-8111-111111111111",
  sequence: 0,
  timestamp: 1,
};

function shipment(withDocuments = true): ShipmentDetail {
  const now = new Date(0).toISOString();
  return {
    id: "shipment-1",
    name: "Test shipment",
    reference: "TEST-1",
    status: "draft",
    latestCheckRunId: null,
    createdAt: now,
    updatedAt: now,
    documentCount: withDocuments ? 1 : 0,
    issueCount: 0,
    latestCheck: null,
    documents: withDocuments
      ? [
          {
            id: "document-1",
            shipmentId: "shipment-1",
            documentType: "commercial_invoice",
            originalName: "invoice.pdf",
            mimeType: "application/pdf",
            sizeBytes: 48,
            storagePath: "user/shipment/invoice.pdf",
            checksumSha256: null,
            version: 1,
            status: "ready",
            replacesDocumentId: null,
            uploadedAt: now,
            updatedAt: now,
          },
        ]
      : [],
    checkHistory: [],
    issues: [],
  };
}

function setup(withDocuments = true) {
  const repository = {
    getShipment: vi.fn().mockResolvedValue(shipment(withDocuments)),
    createCheckRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    setShipmentStatus: vi.fn().mockResolvedValue(undefined),
    completeCheck: vi.fn().mockResolvedValue({ id: "run-1", status: "completed" }),
    failCheck: vi.fn().mockResolvedValue(undefined),
  };
  const download = vi.fn().mockResolvedValue({
    data: new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }),
    error: null,
  });
  mocks.persistenceContext.mockResolvedValue({
    repository,
    userId: "user-1",
    db: { storage: { from: vi.fn(() => ({ download })) } },
  });
  return { repository, download };
}

function callRoute() {
  return POST(new Request("http://localhost/api/shipments/shipment-1/run-check"), {
    params: Promise.resolve({ id: "shipment-1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/shipments/[id]/run-check", () => {
  it("downloads private documents, runs the agent, and persists its event trace", async () => {
    const { repository, download } = setup();
    mocks.runFileConsistency.mockImplementation(async (options) => {
      options.onEvent(runStarted);
      return {
        comparison,
        events: [runStarted],
        status: "complete",
        missingMaterial: [],
      };
    });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.result.outcome).toBe("completed");
    expect(download).toHaveBeenCalledWith("user/shipment/invoice.pdf");
    expect(mocks.runFileConsistency).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [
          expect.objectContaining({ id: "document-1", file: expect.any(File) }),
        ],
        onEvent: expect.any(Function),
      }),
    );
    expect(repository.completeCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        checkRunId: "run-1",
        documentIds: ["document-1"],
        events: [runStarted],
      }),
    );
  });

  it("persists a failed result when extraction is partial", async () => {
    const { repository } = setup();
    mocks.runFileConsistency.mockResolvedValue({
      comparison,
      events: [runStarted],
      status: "partial",
      missingMaterial: ["document-1"],
    });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.result.outcome).toBe("failed");
    expect(repository.failCheck).toHaveBeenCalledWith(
      "run-1",
      "shipment-1",
      expect.objectContaining({ outcome: "failed" }),
      [runStarted],
    );
    expect(repository.completeCheck).not.toHaveBeenCalled();
  });

  it("keeps observed events when the provider fails", async () => {
    const { repository } = setup();
    mocks.runFileConsistency.mockImplementation(async (options) => {
      options.onEvent(runStarted);
      throw new Error("provider unavailable");
    });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.result.failures[0].message).toBe("provider unavailable");
    expect(repository.failCheck).toHaveBeenCalledWith(
      "run-1",
      "shipment-1",
      expect.objectContaining({ outcome: "failed" }),
      [runStarted],
    );
  });

  it("requires at least one stored document", async () => {
    const { repository } = setup(false);

    const response = await callRoute();

    expect(response.status).toBe(400);
    expect(repository.createCheckRun).not.toHaveBeenCalled();
    expect(mocks.runFileConsistency).not.toHaveBeenCalled();
  });
});
