import { describe, expect, it } from "vitest";
import { loadDocumentConsistencyCatalog } from "../../lib/agent/catalog-file";
import {
  compareExtractedDocuments,
  type DynamicComparison,
} from "../../lib/agent/compare-dynamic";
import {
  partitionExtractedFields,
  type ExtractedDocument,
} from "../../lib/agent/fields";

const catalogFromProject = loadDocumentConsistencyCatalog();

function doc(id: string, raw: Record<string, unknown>): ExtractedDocument {
  const { fields, extra, errors } = partitionExtractedFields(raw);
  return { id, fields, extra, errors, provenance: { source: "test", at: 0 } };
}

function row(result: DynamicComparison, field: string) {
  return result.rows.find((r) => r.field === field);
}

describe("document-consistency catalog", () => {
  it("parses field risk / review metadata from the Skill front-matter", () => {
    const catalog = catalogFromProject;

    expect(catalog.version).toBe(1);
    expect(catalog.fields.exporter).toEqual({
      needsHumanReview: true,
      risk: "high",
      guidance: expect.any(String),
    });
    expect(catalog.fields.vessel).toEqual({
      needsHumanReview: false,
      risk: "low",
    });
    expect(catalog.crossFieldRules.map((r) => r.id)).toEqual([
      "invoice_total_matches_lines",
      "net_not_over_gross",
    ]);
  });

  it("maps high-risk mismatch to must_fix", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", { currency: "AUD" }),
        doc("b", { currency: "AUD" }),
        doc("c", { currency: "USD" }),
      ],
      catalog,
    );

    expect(row(result, "currency")?.status).toBe("must_fix");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "currency", status: "must_fix" }),
    );
  });

  it("maps low-risk mismatch to display without an issue", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", { vessel: "MV Star" }),
        doc("b", { vessel: "MV Moon" }),
      ],
      catalog,
    );

    expect(row(result, "vessel")?.status).toBe("display");
    expect(result.issues.some((i) => i.field === "vessel")).toBe(false);
  });

  it("passes needs_human_review fields when their values are consistent", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", { exporter: "Acme Pty Ltd" }),
        doc("b", { exporter: "Acme Pty Ltd" }),
      ],
      catalog,
    );

    expect(row(result, "exporter")?.status).toBe("passed");
    expect(result.issues.some((issue) => issue.field === "exporter")).toBe(false);
  });

  it("does not require human review when a protected field matches", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", { exporter: "Acme Pty Ltd" }),
        doc("b", { exporter: "Acme Pty Ltd" }),
      ],
      catalog,
    );

    expect(result.requiresHumanReview).toBe(false);
    expect(result.issues.find((i) => i.field === "exporter")).toBeUndefined();
  });

  it("sets requiresHumanReview true for a high-risk mismatch", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", { currency: "AUD" }),
        doc("b", { currency: "USD" }),
      ],
      catalog,
    );

    expect(result.requiresHumanReview).toBe(true);
    expect(
      result.issues.find((i) => i.field === "currency"),
    ).toMatchObject({ status: "must_fix", needsHumanReview: false });
  });

  it("sets requiresHumanReview false for a medium mismatch alone", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", { net_weight_kg: 12 }),
        doc("b", { net_weight_kg: 15 }),
      ],
      catalog,
    );

    expect(result.requiresHumanReview).toBe(false);
    expect(
      result.issues.find((i) => i.field === "net_weight_kg"),
    ).toMatchObject({ status: "review", needsHumanReview: false });
  });

  it("runs the invoice total cross-field rule", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [
        doc("a", {
          total_amount: 1000,
          line_items: [
            { description: "A", quantity: 1, unit_price: 400, amount: 400 },
            { description: "B", quantity: 1, unit_price: 400, amount: 400 },
          ],
        }),
      ],
      catalog,
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: "invoice_total_matches_lines",
        status: "must_fix",
      }),
    );
  });

  it("runs the net<=gross cross-field rule", () => {
    const catalog = catalogFromProject;
    const result = compareExtractedDocuments(
      [doc("a", { net_weight_kg: 20, gross_weight_kg: 15 })],
      catalog,
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: "net_not_over_gross",
        status: "review",
      }),
    );
  });
});
