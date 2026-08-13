import OpenAI from "openai";
import type { DocFields, DocKey } from "./types";
import { DOC_NAMES } from "./types";
import { documents as mockDocuments } from "./mockData";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

const FIELDS = [
  "exporter",
  "consignee",
  "description_of_goods",
  "hs_code",
  "country_of_origin",
  "incoterms",
  "port_of_loading",
  "port_of_discharge",
  "vessel",
  "unit_quantity",
  "number_of_packages",
  "net_weight_kg",
  "gross_weight_kg",
  "total_amount",
  "currency",
  "line_items",
] as const;

const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;

const DOC_FIELDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...FIELDS],
  properties: {
    exporter: nullableString,
    consignee: nullableString,
    description_of_goods: nullableString,
    hs_code: nullableString,
    country_of_origin: nullableString,
    incoterms: nullableString,
    port_of_loading: nullableString,
    port_of_discharge: nullableString,
    vessel: nullableString,
    unit_quantity: nullableNumber,
    number_of_packages: nullableString,
    net_weight_kg: nullableNumber,
    gross_weight_kg: nullableNumber,
    total_amount: nullableNumber,
    currency: nullableString,
    line_items: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "amount"],
        properties: {
          description: nullableString,
          quantity: nullableNumber,
          unit_price: nullableNumber,
          amount: nullableNumber,
        },
      },
    },
  },
} as const;

function buildPrompt(docType: string): string {
  return `You are extracting fields from an export document (a ${docType}).
Use null for any field not present on this document.
Numbers (weights, amounts, quantities) must be numeric — strip currency symbols and thousands separators.
"incoterms" is the full term as printed, e.g. "CIF Hamburg".
"number_of_packages" is the raw string as printed, e.g. "3 wooden crates".
"line_items" (invoices only) is an array of {"description","quantity","unit_price","amount"}, else null.
"currency" is the currency code or name as printed, e.g. "AUD".
No commentary — output only the structured JSON object.`;
}

function parseDocFields(text: string): DocFields {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model did not return a JSON object");
  }
  return parsed as DocFields;
}

export async function extractFields(
  file: File,
  docKey: DocKey,
): Promise<DocFields> {
  if (process.env.EXTRACTION_MODE === "mock") {
    return structuredClone(mockDocuments[docKey]);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to web/.env.local (or set EXTRACTION_MODE=mock for sample data).",
    );
  }

  const client = new OpenAI();
  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");

  const response = await client.responses.create({
    model: MODEL,
    max_output_tokens: 2000,
    text: {
      format: {
        type: "json_schema",
        name: "doc_fields",
        description: "Structured fields extracted from one export document",
        strict: true,
        schema: DOC_FIELDS_SCHEMA,
      },
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt(DOC_NAMES[docKey]),
          },
          {
            type: "input_file",
            filename: file.name,
            file_data: `data:application/pdf;base64,${base64}`,
            detail: "high",
          },
        ],
      },
    ],
  });

  return parseDocFields(response.output_text);
}

export async function extractAll(
  files: Record<DocKey, File>,
): Promise<Record<DocKey, DocFields>> {
  const entries = await Promise.all(
    (Object.keys(files) as DocKey[]).map(async (key) => [
      key,
      await extractFields(files[key], key),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<DocKey, DocFields>;
}
