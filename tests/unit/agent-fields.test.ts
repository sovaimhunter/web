import { describe, expect, it } from "vitest";
import { partitionExtractedFields } from "../../lib/agent/fields";

describe("partitionExtractedFields", () => {
  it("keeps typed core fields and separates unknown extras", () => {
    const result = partitionExtractedFields({
      exporter: "Outback Origins Art Co.",
      unit_quantity: 3,
      currency: "AUD",
      some_custom_field: "hello",
    });

    expect(result.fields.exporter).toBe("Outback Origins Art Co.");
    expect(result.fields.unit_quantity).toBe(3);
    expect(result.fields.currency).toBe("AUD");
    expect(result.extra).toEqual({ some_custom_field: "hello" });
    expect(result.errors).toEqual([]);
  });

  it("coerces numeric strings and thousands separators", () => {
    const result = partitionExtractedFields({
      unit_quantity: "03",
      gross_weight_kg: "1,234.5",
      total_amount: 24500,
    });

    expect(result.fields.unit_quantity).toBe(3);
    expect(result.fields.gross_weight_kg).toBe(1234.5);
    expect(result.fields.total_amount).toBe(24500);
    expect(result.errors).toEqual([]);
  });

  it("records type errors and nulls invalid core values", () => {
    const result = partitionExtractedFields({
      exporter: 42,
      unit_quantity: "abc",
    });

    expect(result.fields.exporter).toBeNull();
    expect(result.fields.unit_quantity).toBeNull();
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.field).sort()).toEqual([
      "exporter",
      "unit_quantity",
    ]);
  });

  it("treats blank placeholders as absent", () => {
    const result = partitionExtractedFields({
      exporter: "N/A",
      hs_code: "not provided",
    });

    expect(result.fields.exporter).toBeNull();
    expect(result.fields.hs_code).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it("validates line_items shape", () => {
    const result = partitionExtractedFields({
      line_items: [
        { description: "Painting", quantity: 1, unit_price: 9500, amount: 9500 },
      ],
    });

    expect(result.fields.line_items).toEqual([
      { description: "Painting", quantity: 1, unit_price: 9500, amount: 9500 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("flags malformed line_items", () => {
    const result = partitionExtractedFields({ line_items: "not-an-array" });

    expect(result.fields.line_items).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("line_items");
  });

  it("leaves absent core fields as null without errors", () => {
    const result = partitionExtractedFields({});

    expect(result.fields).toMatchObject({ exporter: null, currency: null });
    expect(result.errors).toEqual([]);
    expect(result.extra).toEqual({});
  });
});
