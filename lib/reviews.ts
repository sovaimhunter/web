const PREFIX = "tradelynk:reviews:";

export type ReviewDecision = {
  field: string;
  /** The value the user confirmed or entered as correct. */
  value: string;
  note: string;
  at: number;
};

export type ReviewMap = Record<string, ReviewDecision>;

export function loadReviews(shipmentId: string): ReviewMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREFIX + shipmentId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as ReviewMap;
  } catch {
    return {};
  }
}

export function saveReview(
  shipmentId: string,
  decision: ReviewDecision,
): void {
  if (typeof window === "undefined") return;
  const reviews = loadReviews(shipmentId);
  reviews[decision.field] = decision;
  localStorage.setItem(PREFIX + shipmentId, JSON.stringify(reviews));
}
