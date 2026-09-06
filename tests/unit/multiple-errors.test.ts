import { describe, expect, it } from "vitest";
import { compareDocuments } from "../../lib/compare";
import type { CheckStatus, DocFields } from "../../lib/types";
import { loadManifest } from "../helpers/fixtures";

const baseline = loadManifest().scenarios.find(
  (scenario) => scenario.id === "01-clean-baseline",
);
if (!baseline) throw new Error("Clean baseline scenario is missing.");
const baselineDocuments = baseline.documents;

function statuses(documents: typeof baselineDocuments) {
  return new Map(
    compareDocuments(documents).rows.map((row) => [
      row.key as keyof DocFields,
      row.status as CheckStatus,
    ]),
  );
}

describe("shipments with multiple issues", () => {
  it("reports several independent errors in one shipment", () => {
    const documents = structuredClone(baselineDocuments);
    documents.packing_list.currency = "USD";
    documents.packing_list.unit_quantity = 4;
    documents.packing_list.gross_weight_kg = 20;
    documents.packing_list.hs_code = "9999.99";
    documents.packing_list.description_of_goods = "Metal sculpture";

    const actual = statuses(documents);
    expect(actual.get("currency")).toBe("must_fix");
    expect(actual.get("unit_quantity")).toBe("must_fix");
    expect(actual.get("gross_weight_kg")).toBe("review");
    expect(actual.get("hs_code")).toBe("review");
    expect(actual.get("description_of_goods")).toBe("review");
  });

  it("passes every available field for the clean baseline", () => {
    const actual = statuses(structuredClone(baselineDocuments));
    expect([...actual.values()].every((status) => status === "passed")).toBe(
      true,
    );
  });

  it("identifies the missing Packing List exporter as the outlier", () => {
    const scenario = loadManifest().scenarios.find(
      (item) => item.id === "15-missing-exporter",
    );
    if (!scenario) throw new Error("Missing exporter scenario is unavailable.");
    const result = compareDocuments(structuredClone(scenario.documents));
    const exporter = result.rows.find((row) => row.key === "exporter");
    expect(exporter?.status).toBe("review");
    expect(exporter?.vals.packing_list).toBeNull();
    expect(exporter?.outliers).toContain("packing_list");
  });
});
