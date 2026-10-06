import { describe, expect, it } from "vitest";
import { compareExtractedDocuments } from "../../lib/agent/compare-dynamic";
import {
  partitionExtractedFields,
  type ExtractedDocument,
} from "../../lib/agent/fields";
import { remapComparisonDocumentIds } from "../../lib/persistence/remap-comparison";

function doc(id: string, raw: Record<string, unknown>): ExtractedDocument {
  const { fields, extra, errors } = partitionExtractedFields(raw);
  return {
    id,
    fields,
    extra,
    errors,
    evidence: { currency: { rawValue: raw.currency, page: 1 } },
    provenance: { source: "test", at: 0 },
  };
}

describe("persisted comparison document ids", () => {
  it("remaps documents, rows, issues, outliers, and evidence together", () => {
    const comparison = compareExtractedDocuments([
      doc("invoice.pdf", { currency: "AUD" }),
      doc("packing.pdf", { currency: "USD" }),
    ]);
    const remapped = remapComparisonDocumentIds(comparison, {
      "invoice.pdf": "11111111-1111-1111-1111-111111111111",
      "packing.pdf": "22222222-2222-2222-2222-222222222222",
    });

    expect(remapped.documents.map((value) => value.id)).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    const row = remapped.rows.find((value) => value.field === "currency");
    expect(Object.keys(row?.values ?? {})).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    const issue = remapped.issues.find((value) => value.field === "currency");
    expect(issue?.outliers).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    expect(issue?.evidence?.["11111111-1111-1111-1111-111111111111"]?.page).toBe(1);
  });
});
