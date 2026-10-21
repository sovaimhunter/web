import { describe, expect, it } from "vitest";
import {
  extractionPrompt,
  parseExtractionResponse,
  parseLooseFields,
  validateTargetedExtraction,
} from "../../lib/agent/openai-extract";

describe("extractionPrompt", () => {
  it("adds evidence-only instructions for a targeted second pass", () => {
    const prompt = extractionPrompt(["hs_code", "country_of_origin"]);
    expect(prompt).toContain("TARGETED SECOND PASS");
    expect(prompt).toContain("hs_code, country_of_origin");
    expect(prompt).toContain("Do not infer");
  });

  it("separates goods descriptions from origin statements and shipping marks", () => {
    const prompt = extractionPrompt(["description_of_goods"]);
    expect(prompt).toContain('"MADE IN AUSTRALIA"');
    expect(prompt).toContain('"C/NO. 1"');
    expect(prompt).toContain("missed or misclassified");
  });
});

describe("parseLooseFields", () => {
  it("parses a plain JSON object", () => {
    expect(parseLooseFields('{"exporter":"Acme Pty Ltd","unit_quantity":3}')).toEqual({
      exporter: "Acme Pty Ltd",
      unit_quantity: 3,
    });
  });

  it("strips markdown code fences", () => {
    expect(parseLooseFields('```json\n{"currency":"AUD"}\n```')).toEqual({
      currency: "AUD",
    });
  });

  it("coerces null placeholders to null", () => {
    expect(
      parseLooseFields('{"hs_code":"N/A","vessel":"not provided"}'),
    ).toEqual({ hs_code: null, vessel: null });
  });

  it("keeps unknown fields as-is", () => {
    expect(parseLooseFields('{"custom_ref":"ABC-123"}')).toEqual({
      custom_ref: "ABC-123",
    });
  });

  it("rejects arrays and non-objects", () => {
    expect(() => parseLooseFields("[1,2,3]")).toThrow();
    expect(() => parseLooseFields("42")).toThrow();
  });
});

describe("parseExtractionResponse", () => {
  it("keeps normalized values separate from page-level source evidence", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "commercial_invoice",
        observations: [
          {
            field: "gross_weight_kg",
            raw_value: "2,204.62 lb",
            normalized_value: 1000,
            unit: "lb",
            page: 2,
            quote: "Gross Weight 2,204.62 lb",
            confidence: 0.96,
          },
        ],
      }),
    );

    expect(extraction.fields.gross_weight_kg).toBe(1000);
    expect(extraction.documentRole).toBe("commercial_invoice");
    expect(extraction.evidence?.gross_weight_kg).toEqual({
      rawValue: "2,204.62 lb",
      unit: "lb",
      page: 2,
      quote: "Gross Weight 2,204.62 lb",
      confidence: 0.96,
    });
  });

  it("normalizes printed weight units in code instead of trusting model arithmetic", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "packing_list",
        observations: [
          {
            field: "net_weight_kg",
            raw_value: "12,000 g",
            normalized_value: 12000,
            unit: "g",
            page: 1,
            quote: "NET WEIGHT 12,000 g",
            confidence: 0.99,
          },
        ],
      }),
    );

    expect(extraction.fields.net_weight_kg).toBe(12);
    expect(extraction.evidence?.net_weight_kg?.unit).toBe("g");
  });

  it("rejects an extraction without observations", () => {
    expect(() =>
      parseExtractionResponse('{"document_role":"invoice"}'),
    ).toThrow("missing observations");
  });

  it("derives document unit quantity from the sum of invoice line items", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "commercial_invoice",
        observations: [
          {
            field: "unit_quantity",
            raw_value: "1",
            normalized_value: 1,
            unit: null,
            page: 1,
            quote: "1",
            confidence: 0.99,
          },
          {
            field: "line_items",
            raw_value: "Three invoice rows",
            normalized_value: [
              { description: "A", quantity: 1, unit_price: 10, amount: 10 },
              { description: "B", quantity: 1, unit_price: 20, amount: 20 },
              { description: "C", quantity: 1, unit_price: 30, amount: 30 },
            ],
            unit: null,
            page: 1,
            quote: "A 1 10 10; B 1 20 20; C 1 30 30",
            confidence: 0.98,
          },
        ],
      }),
    );

    expect(extraction.fields.unit_quantity).toBe(3);
    expect(extraction.evidence?.unit_quantity).toMatchObject({
      rawValue: [1, 1, 1],
      page: 1,
      confidence: 0.98,
    });
  });

  it("recovers shared description and HS code from invoice rows", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "commercial_invoice",
        observations: [
          {
            field: "line_items",
            raw_value: "Three rows",
            normalized_value: [
              {
                description: 'Aboriginal acrylic on linen · "Desert Waterholes"',
                hs_code: "9701.21",
                quantity: 1,
                unit_price: 1,
                amount: 1,
              },
              {
                description: 'Aboriginal acrylic on linen · "Seven Sisters"',
                hs_code: "9701.21",
                quantity: 1,
                unit_price: 1,
                amount: 1,
              },
            ],
            unit: null,
            page: 1,
            quote: "invoice table rows",
            confidence: 0.98,
          },
        ],
      }),
    );

    expect(extraction.fields.description_of_goods).toBe(
      "Aboriginal acrylic on linen",
    );
    expect(extraction.fields.hs_code).toBe("9701.21");
  });

  it("does not treat invoice pieces as transport packages", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "commercial_invoice",
        observations: [
          {
            field: "number_of_packages",
            raw_value: "3 pc",
            normalized_value: 3,
            unit: "pc",
            page: 1,
            quote: "pc pc pc",
            confidence: 0.9,
          },
        ],
      }),
    );

    expect(extraction.fields.number_of_packages).toBeNull();
  });

  it("prevents arrays from leaking into string core fields", () => {
    const rawDescription = "Artwork A; Artwork B";
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "commercial_invoice",
        observations: [
          {
            field: "description_of_goods",
            raw_value: rawDescription,
            normalized_value: [
              { description: "Artwork A", quantity: 1, unit_price: 10, amount: 10 },
            ],
            unit: null,
            page: 1,
            quote: rawDescription,
            confidence: 0.9,
          },
        ],
      }),
    );

    expect(extraction.fields.description_of_goods).toBe(rawDescription);
  });

  it("does not classify freight payment text as an Incoterm", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "bill_of_lading",
        observations: [
          {
            field: "incoterms",
            raw_value: "Freight Prepaid. LCL.",
            normalized_value: "Freight Prepaid. LCL.",
            unit: null,
            page: 1,
            quote: "Freight Prepaid. LCL.",
            confidence: 0.95,
          },
        ],
      }),
    );

    expect(extraction.fields.incoterms).toBeNull();
  });

  it("does not copy Place of Delivery into a blank Port of Discharge cell", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "bill_of_lading",
        observations: [
          {
            field: "port_of_discharge",
            raw_value: "Berlin, Germany",
            normalized_value: "Berlin, Germany",
            unit: null,
            page: 1,
            quote: "Port of Discharge\nPlace of Delivery\nBerlin, Germany",
            confidence: 0.99,
          },
        ],
      }),
    );

    expect(extraction.fields.port_of_discharge).toBeNull();
  });

  it("rejects a bare city from a targeted discharge-port retry", () => {
    const extraction = {
      fields: { port_of_discharge: "Berlin, Germany" },
      evidence: {
        port_of_discharge: {
          rawValue: "Berlin, Germany",
          quote: "Berlin, Germany",
        },
      },
    };

    validateTargetedExtraction(extraction, ["port_of_discharge"]);
    expect(extraction.fields.port_of_discharge).toBeNull();
  });

  it("rejects a discharge value copied into both adjacent delivery fields", () => {
    const extraction = {
      fields: {
        port_of_discharge: "Berlin, Germany",
        place_of_delivery: "Berlin, Germany",
        final_destination: "Berlin, Germany",
      },
      evidence: {
        port_of_discharge: {
          rawValue: "Berlin, Germany",
          quote: "Port of Discharge: Berlin, Germany",
        },
      },
    };

    validateTargetedExtraction(extraction, ["port_of_discharge"]);
    expect(extraction.fields.port_of_discharge).toBeNull();
  });

  it("does not accept a street address as an exporter name", () => {
    const extraction = parseExtractionResponse(
      JSON.stringify({
        document_role: "commercial_invoice",
        observations: [
          {
            field: "exporter",
            raw_value: "42 Todd Street, Alice Springs NT 0870, Australia",
            normalized_value: "42 Todd Street, Alice Springs NT 0870, Australia",
            unit: null,
            page: 1,
            quote: "42 Todd Street, Alice Springs NT 0870, Australia",
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(extraction.fields.exporter).toBeNull();
  });
});
