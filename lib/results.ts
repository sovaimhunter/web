import {
  normalizeActionableStatus,
  normalizeCheckStatus,
} from "./check-status";
import type {
  CheckFailure,
  CheckResult,
  FieldRow,
  Issue,
  StoredCheckResult,
} from "./types";

const RESULT_PREFIX = "tradelynk:result:";

const resultCache = new Map<
  string,
  { raw: string | null; value: StoredCheckResult | null }
>();

function normalizeStoredResult(value: unknown): StoredCheckResult | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;

  if (stored.outcome === "failed" && Array.isArray(stored.failures)) {
    return {
      outcome: "failed",
      files:
        typeof stored.files === "object" && stored.files !== null
          ? (stored.files as StoredCheckResult["files"])
          : {},
      failures: stored.failures as CheckFailure[],
    };
  }

  if (!Array.isArray(stored.rows) || !Array.isArray(stored.issues)) {
    return null;
  }

  const rows = stored.rows.map((value) => {
    const row = value as FieldRow & { status?: unknown };
    return {
      ...row,
      status: normalizeCheckStatus(
        row.status,
        row.consistent ? "passed" : "review",
      ),
    };
  });
  const issues = stored.issues.map((value) => {
    const issue = value as Issue & { severity?: unknown; status?: unknown };
    return {
      field: issue.field,
      message: issue.message,
      detail: issue.detail,
      status: normalizeActionableStatus(issue.status ?? issue.severity),
    };
  });

  return {
    ...(stored as CheckResult),
    outcome: "completed",
    rows,
    issues,
  };
}

export function saveResult(
  shipmentId: string,
  result: StoredCheckResult,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RESULT_PREFIX + shipmentId, JSON.stringify(result));
  resultCache.delete(shipmentId);
}

export function deleteResult(shipmentId: string): void {
  if (typeof window === "undefined") return;
  const key = RESULT_PREFIX + shipmentId;
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
  resultCache.delete(shipmentId);
}

export function loadResult(shipmentId: string): StoredCheckResult | null {
  if (typeof window === "undefined") return null;
  try {
    const key = RESULT_PREFIX + shipmentId;
    const raw =
      localStorage.getItem(key) ?? sessionStorage.getItem(key);
    const cached = resultCache.get(shipmentId);
    if (cached && cached.raw === raw) return cached.value;
    const value = raw ? normalizeStoredResult(JSON.parse(raw)) : null;
    resultCache.set(shipmentId, { raw, value });
    return value;
  } catch {
    return resultCache.get(shipmentId)?.value ?? null;
  }
}
