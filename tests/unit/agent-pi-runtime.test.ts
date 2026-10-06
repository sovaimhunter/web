import { describe, expect, it } from "vitest";
import { parseCatalog } from "../../lib/agent/catalog";
import { partitionExtractedFields, type ExtractedDocument } from "../../lib/agent/fields";
import {
  findTargetedExtractions,
  mergeTargetedExtraction,
  missingDocumentIds,
} from "../../lib/agent/pi/runtime";

function document(id: string, values: Record<string, unknown>): ExtractedDocument {
  const { fields, extra, errors } = partitionExtractedFields(values);
  return {
    id,
    fields,
    extra,
    errors,
    provenance: { source: "test", at: 0 },
  };
}

const catalog = parseCatalog(`---
version: 1
fields:
  exporter: { needs_human_review: true, risk: high }
  hs_code: { needs_human_review: true, risk: high }
  total_amount: { needs_human_review: false, risk: high }
  vessel: { needs_human_review: false, risk: low }
---`);

describe("Pi file-consistency completion guard", () => {
  it("reports every uploaded file that was not extracted", () => {
    expect(
      missingDocumentIds(
        ["invoice.pdf", "packing.pdf", "bol.pdf"],
        [{ id: "invoice.pdf" }, { id: "bol.pdf" }],
      ),
    ).toEqual(["packing.pdf"]);
  });

  it("is complete when all uploaded files were extracted", () => {
    expect(
      missingDocumentIds(
        ["invoice.pdf", "packing.pdf"],
        [{ id: "packing.pdf" }, { id: "invoice.pdf" }],
      ),
    ).toEqual([]);
  });
});

describe("targeted second-pass extraction", () => {
  it("targets a missing key field found in at least two peer documents", () => {
    const targets = findTargetedExtractions(
      [
        document("invoice.pdf", { hs_code: "9701.10" }),
        document("packing.pdf", { hs_code: "9701.10" }),
        document("bol.pdf", {}),
      ],
      catalog,
    );

    expect(targets).toEqual([{ documentId: "bol.pdf", fields: ["hs_code"] }]);
  });

  it("does not target one-off or low-risk fields", () => {
    const targets = findTargetedExtractions(
      [
        document("invoice.pdf", { total_amount: 100, vessel: "MV Star" }),
        document("packing.pdf", { vessel: "MV Star" }),
        document("bol.pdf", {}),
      ],
      catalog,
    );

    expect(targets).toEqual([]);
  });

  it("fills requested blanks without overwriting first-pass values", () => {
    const first = document("invoice.pdf", {
      exporter: "Original Exporter",
      hs_code: null,
    });
    const second = document("invoice.pdf", {
      exporter: "Different Exporter",
      hs_code: "9701.10",
    });
    second.evidence = {
      hs_code: { rawValue: "9701.10", page: 2, quote: "HS 9701.10" },
    };

    const merged = mergeTargetedExtraction(first, second, ["exporter", "hs_code"]);

    expect(merged.fields.exporter).toBe("Original Exporter");
    expect(merged.fields.hs_code).toBe("9701.10");
    expect(merged.evidence?.hs_code).toMatchObject({ page: 2 });
  });
});
