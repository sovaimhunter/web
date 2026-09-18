import { describe, expect, it } from "vitest";
import { compareDocuments } from "../../lib/compare";
import type { DocKey } from "../../lib/types";
import { loadManifest } from "../helpers/fixtures";

const baseline = loadManifest().scenarios.find(
  (scenario) => scenario.id === "01-clean-baseline",
);
if (!baseline) throw new Error("Clean baseline scenario is missing.");
const baselineDocuments = baseline.documents;

function documentsWithCodes(codes: Partial<Record<DocKey, string | null>>) {
  const documents = structuredClone(baselineDocuments);
  for (const key of Object.keys(documents) as DocKey[]) {
    documents[key].hs_code = codes[key] ?? null;
  }
  return documents;
}

describe("HS validation in document comparison", () => {
  it("passes an official eight-digit AHECC item", () => {
    const result = compareDocuments(
      documentsWithCodes({
        invoice: "9701.21.00",
        packing_list: "97012100",
        bill_of_lading: "9701 21 00",
      }),
    );
    const row = result.rows.find((item) => item.key === "hs_code");

    expect(row?.status).toBe("passed");
    expect(result.hsValidation.status).toBe("passed");
    expect(result.hsValidation.officialCode).toBe("97012100");
    expect(result.hsValidation.officialDescription).toContain("PAINTINGS");
    expect(result.issues.some((issue) => issue.field === "HS code")).toBe(false);
  });

  it("creates a Review issue with official evidence for a six-digit HS code", () => {
    const result = compareDocuments(
      documentsWithCodes({
        invoice: "9701.21",
        packing_list: "970121",
        bill_of_lading: "9701 21",
      }),
    );
    const row = result.rows.find((item) => item.key === "hs_code");
    const issue = result.issues.find((item) => item.field === "HS code");

    expect(row?.status).toBe("review");
    expect(issue?.status).toBe("review");
    expect(issue?.message).toContain("six-digit HS");
    expect(issue?.detail["Official AHECC"]).toContain("97012100");
    expect(issue?.detail["Dataset"]).toContain("AHECC");
  });

  it("marks contradictory AHECC values as Must Fix", () => {
    const result = compareDocuments(
      documentsWithCodes({
        invoice: "97012100",
        packing_list: "97019100",
        bill_of_lading: "97012100",
      }),
    );
    const row = result.rows.find((item) => item.key === "hs_code");
    const issue = result.issues.find((item) => item.field === "HS code");

    expect(row?.status).toBe("must_fix");
    expect(issue?.status).toBe("must_fix");
    expect(issue?.detail["Packing List"]).toBe("97019100");
  });

  it("creates an HS row and Review issue when no code was extracted", () => {
    const result = compareDocuments(documentsWithCodes({}));
    const row = result.rows.find((item) => item.key === "hs_code");
    const issue = result.issues.find((item) => item.field === "HS code");

    expect(row?.status).toBe("review");
    expect(row?.vals.invoice).toBeNull();
    expect(row?.outliers).toEqual([
      "invoice",
      "packing_list",
      "bill_of_lading",
    ]);
    expect(issue?.message).toContain("No HS code");
    expect(result.hsValidation.reasons).toContain("CODE_MISSING");
  });
});
