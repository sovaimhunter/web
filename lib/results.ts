import type { CheckResult } from "./types";

const RESULT_PREFIX = "tradelynk:result:";

const resultCache = new Map<
  string,
  { raw: string | null; value: CheckResult | null }
>();

export function saveResult(
  shipmentId: string,
  result: CheckResult,
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

export function loadResult(shipmentId: string): CheckResult | null {
  if (typeof window === "undefined") return null;
  try {
    const key = RESULT_PREFIX + shipmentId;
    const raw =
      localStorage.getItem(key) ?? sessionStorage.getItem(key);
    const cached = resultCache.get(shipmentId);
    if (cached && cached.raw === raw) return cached.value;
    const value = raw ? (JSON.parse(raw) as CheckResult) : null;
    resultCache.set(shipmentId, { raw, value });
    return value;
  } catch {
    return resultCache.get(shipmentId)?.value ?? null;
  }
}
