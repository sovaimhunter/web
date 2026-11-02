import { describe, expect, it } from "vitest";
import { parseCatalog } from "../../lib/agent/catalog";
import { partitionExtractedFields, type ExtractedDocument } from "../../lib/agent/fields";
import {
  buildFileConsistencyPrompt,
  createInMemoryCredentialStore,
  createReviewedExtractionTool,
  findTargetedExtractions,
  mergeTargetedExtraction,
  missingDocumentIds,
} from "../../lib/agent/pi/runtime";
import type { DocumentSource } from "../../lib/agent/file-consistency";

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

describe("serverless Pi credentials", () => {
  it("stores runtime credentials without touching a home directory", async () => {
    const store = createInMemoryCredentialStore();

    expect(await store.read("openai")).toBeUndefined();
    await store.modify("openai", async () => ({
      type: "api_key",
      key: "test-key",
    }));

    expect(await store.read("openai")).toEqual({
      type: "api_key",
      key: "test-key",
    });
    expect(await store.list()).toEqual([
      { providerId: "openai", type: "api_key" },
    ]);

    await store.delete("openai");
    expect(await store.read("openai")).toBeUndefined();
  });

  it("creates the Pi model runtime without filesystem-backed auth or models", async () => {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create({
      credentials: createInMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });

    expect(runtime.getModel("openai", "gpt-4.1-mini")).toBeDefined();
  });
});

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

  it("reserves the retry for a role-expected invoice field even when only one peer found it", () => {
    const invoice = document("invoice.pdf", { exporter: "Acme Pty Ltd" });
    invoice.documentRole = "commercial_invoice";
    const packing = document("packing.pdf", { hs_code: "9701.21" });
    packing.documentRole = "packing_list";

    expect(findTargetedExtractions([invoice, packing], catalog)).toContainEqual({
      documentId: "invoice.pdf",
      fields: ["hs_code", "total_amount"],
    });
  });

  it("does not waste an invoice retry on packing-only weights and package counts", () => {
    const invoice = document("invoice.pdf", {
      exporter: "Acme Pty Ltd",
      hs_code: "9701.21",
      total_amount: 100,
    });
    invoice.documentRole = "commercial_invoice";
    const packing = document("packing.pdf", {
      number_of_packages: 1,
      net_weight_kg: 12,
      gross_weight_kg: 18.5,
    });
    packing.documentRole = "packing_list";
    const bol = document("bol.pdf", {
      number_of_packages: 1,
      net_weight_kg: 12,
      gross_weight_kg: 18.5,
    });
    bol.documentRole = "bill_of_lading";

    const invoiceTarget = findTargetedExtractions(
      [invoice, packing, bol],
      catalog,
    ).find((target) => target.documentId === "invoice.pdf");
    expect(invoiceTarget?.fields ?? []).not.toEqual(
      expect.arrayContaining([
        "number_of_packages",
        "net_weight_kg",
        "gross_weight_kg",
      ]),
    );
  });

  it("rechecks an entity name that was copied from country of origin", () => {
    const invoice = document("invoice.pdf", {
      exporter: "Australia",
      country_of_origin: "Australia",
      hs_code: "9701.21",
      total_amount: 100,
    });
    invoice.documentRole = "commercial_invoice";

    expect(findTargetedExtractions([invoice], catalog)).toContainEqual({
      documentId: "invoice.pdf",
      fields: ["exporter"],
    });
  });

  it("rechecks an address mistakenly normalized as an exporter name", () => {
    const packing = document("packing.pdf", {
      exporter: "42 Todd Street, Alice Springs NT 0870, Australia",
    });
    packing.documentRole = "packing_list";

    const target = findTargetedExtractions([packing], catalog).find(
      (candidate) => candidate.documentId === "packing.pdf",
    );
    expect(target?.fields).toContain("exporter");
  });

  it("rechecks a Bill of Lading discharge port copied from Place of Delivery", () => {
    const bol = document("bol.pdf", {
      exporter: "Acme Pty Ltd",
      port_of_discharge: "Berlin, Germany",
      place_of_delivery: "Berlin, Germany",
    });
    bol.documentRole = "bill_of_lading";

    expect(findTargetedExtractions([bol], catalog)).toContainEqual({
      documentId: "bol.pdf",
      fields: ["port_of_discharge"],
    });
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

describe("ReAct semantic extraction review", () => {
  it("keeps the model on one initial pass so the runtime can allocate the retry", () => {
    const prompt = buildFileConsistencyPrompt(["invoice.pdf", "bol.pdf"]);
    expect(prompt).toContain("exactly once");
    expect(prompt).toContain("Do not call the same file again");
    expect(prompt).toContain("reserves the single targeted retry");
  });

  it("replaces only suspicious fields and preserves the rest of the first pass", async () => {
    let call = 0;
    const source: DocumentSource = {
      async get() {
        call += 1;
        return call === 1
          ? {
              fields: {
                exporter: "Outback Origins Art Co.",
                description_of_goods: "Made in Australia",
              },
              evidence: {
                description_of_goods: {
                  rawValue: "MADE IN AUSTRALIA",
                  quote: "C/NO. 1 MADE IN AUSTRALIA",
                  page: 1,
                },
              },
            }
          : {
              fields: { description_of_goods: null },
            };
      },
    };
    const reviewed = createReviewedExtractionTool(source);
    const signal = new AbortController().signal;

    await reviewed.port.execute(
      { name: "extract_file", arguments: { file: "bol.pdf" } },
      signal,
    );
    const corrected = (await reviewed.port.execute(
      {
        name: "extract_file",
        arguments: { file: "bol.pdf", fields: ["description_of_goods"] },
      },
      signal,
    )) as ExtractedDocument;

    expect(corrected.fields.exporter).toBe("Outback Origins Art Co.");
    expect(corrected.fields.description_of_goods).toBeNull();
    expect(corrected.evidence?.description_of_goods).toBeUndefined();
    expect(reviewed.attemptsFor("bol.pdf")).toBe(2);
  });

  it("refuses a third extraction attempt for the same PDF", async () => {
    const source: DocumentSource = {
      async get() {
        return { fields: { hs_code: "9701.21" } };
      },
    };
    const reviewed = createReviewedExtractionTool(source);
    const signal = new AbortController().signal;

    await reviewed.port.execute(
      { name: "extract_file", arguments: { file: "invoice.pdf" } },
      signal,
    );
    await reviewed.port.execute(
      {
        name: "extract_file",
        arguments: { file: "invoice.pdf", fields: ["hs_code"] },
      },
      signal,
    );

    await expect(
      reviewed.port.execute(
        {
          name: "extract_file",
          arguments: { file: "invoice.pdf", fields: ["hs_code"] },
        },
        signal,
      ),
    ).rejects.toThrow("at most 2 attempts");
  });
});
