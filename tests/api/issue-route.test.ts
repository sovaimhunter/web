import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistenceContext: vi.fn(),
}));

vi.mock("@/lib/persistence/context", () => ({
  persistenceContext: mocks.persistenceContext,
}));

import { PATCH } from "../../app/api/shipments/[id]/issues/[issueId]/route";

const context = {
  params: Promise.resolve({ id: "shipment-1", issueId: "issue-1" }),
};

function request(body: unknown) {
  return new Request("http://localhost/api/shipments/shipment-1/issues/issue-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistenceContext.mockResolvedValue({
    userId: "user-1",
    repository: {
      updateIssue: vi.fn().mockResolvedValue({ id: "issue-1" }),
    },
  });
});

describe("PATCH /api/shipments/[id]/issues/[issueId]", () => {
  it("records the authenticated reviewer when marking an issue reviewed", async () => {
    const persistence = await mocks.persistenceContext();
    mocks.persistenceContext.mockResolvedValue(persistence);

    const response = await PATCH(request({ status: "reviewed" }), context);

    expect(response.status).toBe(200);
    expect(persistence.repository.updateIssue).toHaveBeenCalledWith(
      "issue-1",
      "shipment-1",
      "reviewed",
      { note: undefined, resolutionMethod: undefined, reviewedBy: "user-1" },
    );
  });

  it("does not allow a user to resolve a normal issue directly", async () => {
    const persistence = await mocks.persistenceContext();
    mocks.persistenceContext.mockResolvedValue(persistence);

    const response = await PATCH(request({ status: "resolved" }), context);

    expect(response.status).toBe(400);
    expect(persistence.repository.updateIssue).not.toHaveBeenCalled();
  });

  it("requires an audit note when accepting an expected difference", async () => {
    const persistence = await mocks.persistenceContext();
    mocks.persistenceContext.mockResolvedValue(persistence);

    const response = await PATCH(
      request({ status: "resolved", resolutionMethod: "accepted_exception", note: "" }),
      context,
    );

    expect(response.status).toBe(400);
    expect(persistence.repository.updateIssue).not.toHaveBeenCalled();
  });

  it("records an accepted exception with reviewer and note", async () => {
    const persistence = await mocks.persistenceContext();
    mocks.persistenceContext.mockResolvedValue(persistence);

    const response = await PATCH(
      request({
        status: "resolved",
        resolutionMethod: "accepted_exception",
        note: "Intentional registered importer name.",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(persistence.repository.updateIssue).toHaveBeenCalledWith(
      "issue-1",
      "shipment-1",
      "resolved",
      {
        note: "Intentional registered importer name.",
        resolutionMethod: "accepted_exception",
        reviewedBy: "user-1",
      },
    );
  });
});
