import type { DynamicComparison, DynamicIssue, DynamicRow } from "../agent/compare-dynamic";

function remapRecord(
  values: Record<string, unknown>,
  documentIds: Record<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([id, value]) => [documentIds[id] ?? id, value]),
  );
}

export function remapComparisonDocumentIds(
  comparison: DynamicComparison,
  documentIds: Record<string, string>,
): DynamicComparison {
  const rows: DynamicRow[] = comparison.rows.map((row) => ({
    ...row,
    values: remapRecord(row.values, documentIds),
    outliers: row.outliers.map((id) => documentIds[id] ?? id),
  }));
  const issues: DynamicIssue[] = comparison.issues.map((issue) => ({
    ...issue,
    values: remapRecord(issue.values, documentIds),
    evidence: issue.evidence
      ? (remapRecord(issue.evidence, documentIds) as DynamicIssue["evidence"])
      : undefined,
    outliers: issue.outliers.map((id) => documentIds[id] ?? id),
  }));
  return {
    ...comparison,
    documents: comparison.documents.map((document) => ({
      ...document,
      id: documentIds[document.id] ?? document.id,
    })),
    rows,
    issues,
  };
}
