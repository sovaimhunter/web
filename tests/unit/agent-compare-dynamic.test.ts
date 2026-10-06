import { describe, expect, it } from "vitest";
import {
  compareExtractedDocuments,
  type DynamicComparison,
} from "../../lib/agent/compare-dynamic";
import {
  partitionExtractedFields,
  type ExtractedDocument,
} from "../../lib/agent/fields";

function doc(id: string, raw: Record<string, unknown>): ExtractedDocument {
  const { fields, extra, errors } = partitionExtractedFields(raw);
  return { id, fields, extra, errors, provenance: { source: "test", at: 0 } };
}

function row(result: DynamicComparison, field: string) {
  return result.rows.find((r) => r.field === field);
}

describe("compareExtractedDocuments", () => {
  it("displays (never flags) a field present in only one document", () => {
    const result = compareExtractedDocuments([
      doc("a", { exporter: "Acme Pty Ltd" }),
      doc("b", { consignee: "Buyer GmbH" }),
    ]);

    expect(row(result, "exporter")?.status).toBe("display");
    expect(result.issues.some((i) => i.field === "exporter")).toBe(false);
  });

  it("passes matching repeated fields and flags mismatches with outliers", () => {
    const result = compareExtractedDocuments([
      doc("a", { exporter: "Acme Pty Ltd", currency: "AUD" }),
      doc("b", { exporter: "Acme Pty Ltd", currency: "AUD" }),
      doc("c", { exporter: "Acme Pty Ltd", currency: "USD" }),
    ]);

    expect(row(result, "exporter")?.status).toBe("passed");
    expect(row(result, "currency")?.status).toBe("review");
    expect(row(result, "currency")?.outliers).toEqual(["c"]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "currency", status: "review" }),
    );
  });

  it("treats equivalent numeric formatting as a match", () => {
    const result = compareExtractedDocuments([
      doc("a", { unit_quantity: "03", gross_weight_kg: "1,234.5" }),
      doc("b", { unit_quantity: 3, gross_weight_kg: 1234.5 }),
    ]);

    expect(row(result, "unit_quantity")?.status).toBe("passed");
    expect(row(result, "gross_weight_kg")?.status).toBe("passed");
  });

  it("compares unknown extra fields with generic equivalence", () => {
    const result = compareExtractedDocuments([
      doc("a", { custom_ref: "ABC-123" }),
      doc("b", { custom_ref: "ABC-123" }),
      doc("c", { custom_ref: "XYZ-999" }),
    ]);

    const extraRow = row(result, "custom_ref");
    expect(extraRow?.kind).toBe("extra");
    expect(extraRow?.status).toBe("review");
    expect(extraRow?.outliers).toEqual(["c"]);
  });

  it("marks all documents as outliers when there is no consensus", () => {
    const result = compareExtractedDocuments([
      doc("a", { exporter: "Alpha Co" }),
      doc("b", { exporter: "Beta Co" }),
      doc("c", { exporter: "Gamma Co" }),
    ]);

    const exporter = row(result, "exporter");
    expect(exporter?.status).toBe("review");
    expect([...(exporter?.outliers ?? [])].sort()).toEqual(["a", "b", "c"]);
  });

  it("flags a type error as a review issue even when the field is single", () => {
    const result = compareExtractedDocuments([
      doc("a", { exporter: 42 }),
      doc("b", { exporter: "Acme Pty Ltd" }),
    ]);

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: "exporter",
        status: "review",
        outliers: ["a"],
      }),
    );
  });

  it("keeps absent values as null in each row", () => {
    const result = compareExtractedDocuments([
      doc("a", { exporter: "Acme Pty Ltd" }),
      doc("b", {}),
    ]);

    const exporter = row(result, "exporter");
    expect(exporter?.presentCount).toBe(1);
    expect(exporter?.values).toEqual({ a: "Acme Pty Ltd", b: null });
  });

  it("carries extraction evidence into a conflict issue", () => {
    const first = doc("a", { currency: "AUD" });
    first.evidence = {
      currency: { rawValue: "AUD", page: 1, quote: "Currency: AUD", confidence: 0.99 },
    };
    const second = doc("b", { currency: "USD" });
    second.evidence = {
      currency: { rawValue: "USD", page: 3, quote: "Currency USD", confidence: 0.9 },
    };

    const issue = compareExtractedDocuments([first, second]).issues.find(
      (candidate) => candidate.field === "currency",
    );

    expect(issue?.evidence).toEqual({
      a: first.evidence.currency,
      b: second.evidence.currency,
    });
  });
});
