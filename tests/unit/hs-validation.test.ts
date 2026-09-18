import { describe, expect, it } from "vitest";
import {
  validateHsCodes,
  type AheccDataset,
} from "../../lib/hs-validation";
import type { DocKey } from "../../lib/types";
import { loadManifest } from "../helpers/fixtures";

const baseline = loadManifest().scenarios.find(
  (scenario) => scenario.id === "01-clean-baseline",
);
if (!baseline) throw new Error("Clean baseline scenario is missing.");
const baselineDocuments = baseline.documents;

const dataset: AheccDataset = {
  id: "ahecc-2022-2023-04-18-test",
  title: "Australian Harmonized Export Commodity Classification (AHECC), 2022",
  hsEdition: "2022",
  effectiveFrom: "2022-01-01",
  updatedAt: "2023-04-18",
  sourceUrl:
    "https://www.abs.gov.au/statistics/classifications/australian-harmonized-export-commodity-classification-ahecc/latest-release",
  sourceChecksum: "test-checksum",
  entries: [
    {
      code: "08081001",
      description: "Apples - Delicious (red, ordinary, golden, earlidel)",
      unitOfQuantity: "kg",
    },
    {
      code: "97012100",
      description:
        "Paintings, drawings and pastels, executed entirely by hand - Paintings",
      unitOfQuantity: "No.",
    },
    {
      code: "97019100",
      description:
        "Paintings, drawings and pastels, executed entirely by hand - Other",
      unitOfQuantity: "No.",
    },
  ],
};

function documentsWithCodes(
  codes: Partial<Record<DocKey, string | null>>,
  description = "Original painting on linen",
) {
  const documents = structuredClone(baselineDocuments);
  for (const key of Object.keys(documents) as DocKey[]) {
    documents[key].hs_code = codes[key] ?? null;
    documents[key].description_of_goods = description;
  }
  return documents;
}

describe("AHECC validation", () => {
  it("passes an official eight-digit AHECC code with a compatible description", () => {
    const result = validateHsCodes(
      documentsWithCodes({
        invoice: "9701.21.00",
        packing_list: "97012100",
        bill_of_lading: "9701 21 00",
      }),
      dataset,
    );

    expect(result.status).toBe("passed");
    expect(result.normalizedCode).toBe("97012100");
    expect(result.scope).toBe("ahecc");
    expect(result.exists).toBe(true);
    expect(result.officialDescription).toContain("Paintings");
    expect(result.dataset.id).toBe(dataset.id);
  });

  it("reviews a valid six-digit HS subheading because the AHECC extension is incomplete", () => {
    const result = validateHsCodes(
      documentsWithCodes({
        invoice: "9701.21",
        packing_list: "970121",
        bill_of_lading: "9701 21",
      }),
      dataset,
    );

    expect(result.status).toBe("review");
    expect(result.scope).toBe("hs");
    expect(result.exists).toBe(true);
    expect(result.reasons).toContain("AHECC_EXTENSION_REQUIRED");
  });

  it("reviews compatible six- and eight-digit codes without treating them as a contradiction", () => {
    const result = validateHsCodes(
      documentsWithCodes({
        invoice: "9701.21.00",
        packing_list: "9701.21",
        bill_of_lading: "97012100",
      }),
      dataset,
    );

    expect(result.status).toBe("review");
    expect(result.scope).toBe("mixed");
    expect(result.reasons).toContain("AHECC_EXTENSION_REQUIRED");
    expect(result.reasons).not.toContain("CODES_CONFLICT");
  });

  it("marks invalid characters or an impossible length as Must Fix", () => {
    const result = validateHsCodes(
      documentsWithCodes({ invoice: "97AB.21" }),
      dataset,
    );

    expect(result.status).toBe("must_fix");
    expect(result.exists).toBeNull();
    expect(result.reasons).toContain("INVALID_FORMAT");
  });

  it("marks contradictory document codes as Must Fix", () => {
    const result = validateHsCodes(
      documentsWithCodes({
        invoice: "97012100",
        packing_list: "97019100",
        bill_of_lading: "97012100",
      }),
      dataset,
    );

    expect(result.status).toBe("must_fix");
    expect(result.reasons).toContain("CODES_CONFLICT");
  });

  it("reviews a well-formed AHECC code that is absent from the official dataset", () => {
    const result = validateHsCodes(
      documentsWithCodes({ invoice: "99999999" }),
      dataset,
    );

    expect(result.status).toBe("review");
    expect(result.exists).toBe(false);
    expect(result.reasons).toContain("CODE_NOT_FOUND");
  });

  it("reviews an official code whose description appears incompatible", () => {
    const result = validateHsCodes(
      documentsWithCodes(
        {
          invoice: "97012100",
          packing_list: "97012100",
          bill_of_lading: "97012100",
        },
        "Industrial steel bolts and fasteners",
      ),
      dataset,
    );

    expect(result.status).toBe("review");
    expect(result.exists).toBe(true);
    expect(result.reasons).toContain("DESCRIPTION_REVIEW");
  });

  it("reviews a shipment when no HS code was extracted", () => {
    const result = validateHsCodes(documentsWithCodes({}), dataset);

    expect(result.status).toBe("review");
    expect(result.scope).toBe("none");
    expect(result.exists).toBeNull();
    expect(result.reasons).toContain("CODE_MISSING");
  });
});
