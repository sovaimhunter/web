import type { ActionableCheckStatus, CheckStatus } from "./types";

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  must_fix: "Must Fix",
  review: "Review",
  passed: "Passed",
};

/** Converts results saved before the canonical status model was introduced. */
export function normalizeCheckStatus(
  value: unknown,
  fallback: CheckStatus = "review",
): CheckStatus {
  if (value === "must_fix" || value === "mismatch" || value === "error") {
    return "must_fix";
  }
  if (value === "review" || value === "warning") return "review";
  if (value === "passed" || value === "match") return "passed";
  return fallback;
}

export function normalizeActionableStatus(
  value: unknown,
): ActionableCheckStatus {
  return normalizeCheckStatus(value) === "must_fix" ? "must_fix" : "review";
}
