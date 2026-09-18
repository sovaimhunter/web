import { describe, expect, it } from "vitest";
import { AHECC_DATASET } from "../../lib/ahecc-data";

describe("pinned official AHECC dataset", () => {
  it("contains a complete-looking set of unique eight-digit export items", () => {
    expect(AHECC_DATASET.entries.length).toBeGreaterThan(5_000);
    expect(
      AHECC_DATASET.entries.every((entry) => /^\d{8}$/.test(entry.code)),
    ).toBe(true);
    expect(new Set(AHECC_DATASET.entries.map((entry) => entry.code)).size).toBe(
      AHECC_DATASET.entries.length,
    );
  });

  it("records the official source version and downloaded archive checksum", () => {
    expect(AHECC_DATASET.id).toBe("ahecc-2022-2023-04-18");
    expect(AHECC_DATASET.hsEdition).toBe("2022");
    expect(AHECC_DATASET.updatedAt).toBe("2023-04-18");
    expect(AHECC_DATASET.sourceChecksum).toBe(
      "ffaee05fe374cd06d902f6bf473fb704ca050e5d4c20259e4f6fb3574aae7225",
    );
    expect(AHECC_DATASET.sourceUrl).toContain("abs.gov.au");
  });

  it("contains known AHECC items without footnote suffixes", () => {
    const painting = AHECC_DATASET.entries.find(
      (entry) => entry.code === "97012100",
    );
    const apple = AHECC_DATASET.entries.find(
      (entry) => entry.code === "08081001",
    );

    expect(painting?.description.toLowerCase()).toContain("paintings");
    expect(painting?.unitOfQuantity).toBe("NO");
    expect(apple?.description.toLowerCase()).toContain("apples");
  });
});
