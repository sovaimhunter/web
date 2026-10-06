import OpenAI from "openai";
import type {
  DocumentExtraction,
  DocumentSource,
  RawFieldBag,
} from "./file-consistency";
import type { FieldEvidence } from "./fields";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

const EXTRACTION_PROMPT = `You are extracting auditable fields from one export document.
Return one observation for every field that is visibly present. Do not invent
missing fields. Identify the document role from its content, not its filename.

Use these canonical field names when the document contains them:
exporter, consignee, description_of_goods, hs_code, country_of_origin,
incoterms, port_of_loading, port_of_discharge, vessel, unit_quantity,
number_of_packages, net_weight_kg, gross_weight_kg, total_amount, currency,
line_items.

For any other field, use a short descriptive snake_case key.

EVIDENCE AND NORMALIZATION RULES:
- raw_value and quote must preserve the printed source text. Never correct,
  translate, or paraphrase them.
- normalized_value is the value used for comparison. Numbers must be numeric.
- For weights, put kilograms in normalized_value and record the printed unit.
  Convert tonnes x 1000, grams / 1000, and pounds x 0.453592.
- page is the 1-based PDF page containing the quote.
- confidence is extraction confidence from 0 to 1. Lower it for unclear scans.
- "unit_quantity" is the TOTAL number of sellable/shipped goods on the document,
  not one line-item quantity, the package count, or a weight. For an invoice,
  sum every line-item quantity. For a packing list, use total pieces/units. For
  a Bill of Lading, extract an explicit goods count from Description of Goods
  (for example, "3 original paintings" means 3).
- "number_of_packages" is physical transport packaging only (for example,
  cartons, crates, pallets, cases, drums, bags, or containers). A line-item unit
  such as pc, piece, or unit is goods quantity, not package count.
- normalized_value must match the field type: arrays are allowed ONLY for
  "line_items". Descriptions, names, codes, ports, vessels, countries,
  Incoterms, and currencies must be strings.
- For exporter and consignee normalized_value, use the legal entity name only;
  raw_value and quote must still preserve the source text.
- "line_items" is an array of {"description","quantity","unit_price","amount"} when
  present.
- "currency" is the printed currency code, e.g. "AUD".
- On a Bill of Lading, derive "unit_quantity" from the Description of Goods only.
  Never use the Net Weight or Gross Weight column as the goods quantity.
`;

export function extractionPrompt(requestedFields: string[] = []): string {
  if (requestedFields.length === 0) return EXTRACTION_PROMPT;
  return `${EXTRACTION_PROMPT}

TARGETED SECOND PASS:
The first pass may have missed these fields: ${requestedFields.join(", ")}.
Inspect the entire PDF again, especially table headers, repeated page headers,
footers, labels, and adjacent columns. Return observations only for the named
fields when their values are visibly supported by the document. Do not infer,
guess, or copy a value from another document. If a named field is not visibly
present, omit it from observations.`;
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const lineItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: nullableString,
    quantity: nullableNumber,
    unit_price: nullableNumber,
    amount: nullableNumber,
  },
  required: ["description", "quantity", "unit_price", "amount"],
} as const;
const normalizedValueSchema = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "null" },
    { type: "array", items: lineItemSchema },
  ],
} as const;

const EXTRACTION_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "export_document_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      document_role: nullableString,
      observations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            raw_value: {
              anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
            },
            normalized_value: normalizedValueSchema,
            unit: nullableString,
            page: { anyOf: [{ type: "integer" }, { type: "null" }] },
            quote: nullableString,
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "field",
            "raw_value",
            "normalized_value",
            "unit",
            "page",
            "quote",
            "confidence",
          ],
        },
      },
    },
    required: ["document_role", "observations"],
  },
} as const;

export function parseLooseFields(text: string): RawFieldBag {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Model did not return a flat JSON object");
  }

  const out: RawFieldBag = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] =
      typeof value === "string" &&
      /^(?:null|none|n\/a|not provided|not present)$/i.test(value.trim())
        ? null
        : value;
  }
  return out;
}

type ExtractionObservation = {
  field: string;
  raw_value: unknown;
  normalized_value: unknown;
  unit: string | null;
  page: number | null;
  quote: string | null;
  confidence: number;
};

/** Parse the strict extraction envelope into the domain source contract. */
export function parseExtractionResponse(text: string): DocumentExtraction {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Model did not return an extraction object");
  }
  const envelope = parsed as {
    document_role?: unknown;
    observations?: unknown;
  };
  if (!Array.isArray(envelope.observations)) {
    throw new Error("Model extraction is missing observations");
  }

  const fields: RawFieldBag = {};
  const evidence: Record<string, FieldEvidence> = {};
  for (const candidate of envelope.observations) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error("Model returned an invalid observation");
    }
    const observation = candidate as ExtractionObservation;
    if (typeof observation.field !== "string" || observation.field.trim() === "") {
      throw new Error("Model returned an observation without a field name");
    }
    const name = observation.field.trim();
    let normalizedValue = observation.normalized_value;
    if (name !== "line_items" && Array.isArray(normalizedValue)) {
      normalizedValue =
        name === "description_of_goods" && typeof observation.raw_value === "string"
          ? observation.raw_value
          : null;
    }
    if (name === "number_of_packages") {
      const packagingContext = `${String(observation.raw_value ?? "")} ${String(
        observation.quote ?? "",
      )}`;
      const hasPackagingUnit =
        /\b(?:packages?|pkgs?|cartons?|crates?|pallets?|boxes?|cases?|drums?|bags?|containers?)\b/i.test(
          packagingContext,
        );
      if (!hasPackagingUnit) normalizedValue = null;
    }
    fields[name] = normalizedValue;
    evidence[name] = {
      rawValue: observation.raw_value,
      ...(typeof observation.page === "number" ? { page: observation.page } : {}),
      ...(typeof observation.quote === "string" ? { quote: observation.quote } : {}),
      ...(typeof observation.confidence === "number"
        ? { confidence: observation.confidence }
        : {}),
      ...(typeof observation.unit === "string" ? { unit: observation.unit } : {}),
    };
  }

  // Invoices commonly repeat quantity once per line. The line-item array is a
  // better deterministic source for the document-level total than any single
  // quantity cell selected by the model.
  const lineItems = fields.line_items;
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    const quantities = lineItems.map((item) =>
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>).quantity
        : null,
    );
    if (
      quantities.every(
        (quantity): quantity is number =>
          typeof quantity === "number" && Number.isFinite(quantity),
      )
    ) {
      fields.unit_quantity = quantities.reduce((sum, quantity) => sum + quantity, 0);
      const lineEvidence = evidence.line_items;
      evidence.unit_quantity = {
        rawValue: quantities,
        ...(lineEvidence?.page ? { page: lineEvidence.page } : {}),
        ...(lineEvidence?.quote ? { quote: lineEvidence.quote } : {}),
        ...(typeof lineEvidence?.confidence === "number"
          ? { confidence: lineEvidence.confidence }
          : {}),
      };
    }
  }

  return {
    fields,
    evidence,
    documentRole:
      typeof envelope.document_role === "string" ? envelope.document_role : null,
    source: "openai-responses",
  };
}

/**
 * DocumentSource backed by real OpenAI extraction. `files` maps a file id to
 * the uploaded PDF bytes; `get(id)` extracts values and source evidence.
 */
export class OpenAIDocumentSource implements DocumentSource {
  constructor(
    private readonly files: Record<string, File>,
    private readonly client = new OpenAI({ timeout: 90_000, maxRetries: 1 }),
  ) {}

  async get(
    fileId: string,
    requestedFields: string[] = [],
  ): Promise<DocumentExtraction | undefined> {
    const file = this.files[fileId];
    if (!file) return undefined;

    const bytes = Buffer.from(await file.arrayBuffer());
    const base64 = bytes.toString("base64");
    const response = await this.client.responses.create({
      model: MODEL,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: extractionPrompt(requestedFields) },
            {
              type: "input_file",
              filename: file.name,
              file_data: `data:application/pdf;base64,${base64}`,
              detail: "high",
            },
          ],
        },
      ],
      text: { format: EXTRACTION_RESPONSE_FORMAT },
    });

    return parseExtractionResponse(response.output_text);
  }
}
