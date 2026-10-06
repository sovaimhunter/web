import type { StoredAgentResult } from "./agent/result";

const RESULT_PREFIX = "tradelynk:result:";

const resultCache = new Map<
  string,
  { raw: string | null; value: StoredAgentResult | null }
>();

function normalizeStoredResult(value: unknown): StoredAgentResult | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  if (stored.outcome === "failed" && Array.isArray(stored.failures)) {
    return value as StoredAgentResult;
  }
  if (
    stored.outcome === "completed" &&
    typeof stored.comparison === "object" &&
    stored.comparison !== null
  ) {
    return value as StoredAgentResult;
  }
  return null;
}

export function saveResult(
  shipmentId: string,
  result: StoredAgentResult,
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

export function loadResult(shipmentId: string): StoredAgentResult | null {
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
