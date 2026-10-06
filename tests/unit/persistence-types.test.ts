import { describe, expect, it } from "vitest";
import { inferDocumentType } from "../../lib/persistence/types";

describe("document type inference", () => {
  it.each([
    ["01_commercial_invoice.pdf", "commercial_invoice"],
    ["Packing List final.PDF", "packing_list"],
    ["ocean-BOL-123.pdf", "bill_of_lading"],
    ["Certificate of Origin.pdf", "certificate_of_origin"],
    ["insurance-certificate.pdf", "other"],
  ] as const)("maps %s to %s", (filename, expected) => {
    expect(inferDocumentType(filename)).toBe(expected);
  });
});
