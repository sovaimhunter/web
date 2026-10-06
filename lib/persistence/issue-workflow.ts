import type { IssueRecord } from "./types";

export type IssueQueue = {
  todo: IssueRecord[];
  resolved: IssueRecord[];
};

export function partitionIssues(
  issues: IssueRecord[],
  latestCheckRunId: string | null,
): IssueQueue {
  const current = latestCheckRunId
    ? issues.filter((issue) => issue.checkRunId === latestCheckRunId)
    : [];

  return {
    todo: current.filter(
      (issue) =>
        issue.status !== "resolved" && issue.outlierDocumentIds.length > 0,
    ),
    resolved: issues.filter((issue) => issue.status === "resolved"),
  };
}

export function humanizeField(field: string): string {
  return field
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function resolutionLabel(issue: IssueRecord): string {
  switch (issue.resolutionMethod) {
    case "recheck_cleared":
      return "Cleared by re-check";
    case "recheck_persisted":
      return "Rechecked — still present";
    case "accepted_exception":
      return "Recorded as expected";
    default:
      return "Resolved";
  }
}
