import { describe, expect, it } from "vitest";
import {
  humanizeField,
  isConfirmationIssue,
  partitionIssues,
  resolutionLabel,
} from "../../lib/persistence/issue-workflow";
import type { IssueRecord } from "../../lib/persistence/types";

function issue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: "issue-1",
    shipmentId: "shipment-1",
    checkRunId: "run-2",
    previousIssueId: null,
    resolvedByCheckRunId: null,
    fingerprint: "fingerprint",
    fieldKey: "invoice_number",
    severity: "review",
    status: "open",
    needsHumanReview: false,
    message: "differs",
    valuesByDocument: {},
    evidenceByDocument: {},
    outlierDocumentIds: [],
    resolutionMethod: null,
    resolutionNote: null,
    reviewedBy: null,
    reviewedAt: null,
    resolvedAt: null,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("issue workbench presentation", () => {
  it("separates actionable findings, confirmations, and resolved history", () => {
    const todo = issue({ id: "todo", outlierDocumentIds: ["invoice"] });
    const confirm = issue({ id: "confirm", needsHumanReview: true });
    const oldOpen = issue({ id: "old", checkRunId: "run-1" });
    const resolved = issue({
      id: "resolved",
      checkRunId: "run-1",
      status: "resolved",
      resolutionMethod: "recheck_cleared",
    });

    const queues = partitionIssues([todo, confirm, oldOpen, resolved], "run-2");

    expect(queues.todo.map((value) => value.id)).toEqual(["todo"]);
    expect(queues.confirm.map((value) => value.id)).toEqual(["confirm"]);
    expect(queues.resolved.map((value) => value.id)).toEqual(["resolved"]);
  });

  it("only treats consistent human-review findings as confirmations", () => {
    expect(isConfirmationIssue(issue({ needsHumanReview: true }))).toBe(true);
    expect(
      isConfirmationIssue(
        issue({ needsHumanReview: true, outlierDocumentIds: ["invoice"] }),
      ),
    ).toBe(false);
  });

  it("provides readable field and audit labels", () => {
    expect(humanizeField("gross_weight_check")).toBe("Gross Weight Check");
    expect(
      resolutionLabel(issue({ resolutionMethod: "accepted_exception" })),
    ).toBe("Recorded as expected");
  });
});
