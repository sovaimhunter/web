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
STRICT TRANSCRIPTION RULE FOR EVERY STRING FIELD:
- Copy the value exactly as printed in the relevant field or value area.
- Do not summarize, paraphrase, translate, correct, infer, expand, shorten, or standardize the text.
- Preserve every printed word and its order, including country names in ports, qualifiers in goods descriptions, capitalization, punctuation, and abbreviations.
- Never replace the printed wording with a synonym or a more natural description.
- Printed labels identify the field but are not part of its value.
Numbers (weights, amounts, quantities) must be numeric — strip currency symbols and thousands separators.
Convert every weight to kilograms before returning it: tonnes × 1000, grams ÷ 1000, and pounds × 0.453592.
"unit_quantity" is the number of goods, not the package count. Normalize leading zeros and number words (for example, "03 pieces" and "three units" both become 3).
For "exporter" and "consignee", transcribe the printed legal entity name exactly, but do not include street addresses, cities, postcodes, or countries. Stop after the legal entity suffix (for example Co., Pty Ltd, Ltd, LLC, Inc., or GmbH), even when the address follows on the same extracted line.
Respect the printed field labels and their boxes: exporter comes only from Exporter/Shipper, and consignee comes only from Consignee. If the Exporter/Shipper box is blank, return exporter=null; never move the consignee into exporter.
For "description_of_goods", transcribe the complete goods-description wording exactly as printed in the document's summary/description field. Do not turn it into a generic description and do not add words such as "art", "artwork", "painting", or "goods" unless those words are printed there. Exclude separate product titles, product codes, quantities, and marks and numbers when they are outside that description value.
For "vessel", return only the vessel name. Do not include a voyage number such as "V.0842E".
For route fields, use only the explicitly labelled field. Do not substitute Place of Delivery or Final Destination for a blank Port of Discharge; return null when the labelled field is blank.
On a Bill of Lading, derive "unit_quantity" from Description of Goods only. Never use the Net Weight or Gross Weight column as the goods quantity.
"incoterms" is the full term as printed, e.g. "CIF Hamburg".
"number_of_packages" is the raw string as printed, e.g. "3 wooden crates".
"line_items" (invoices only) is an array of {"description","quantity","unit_price","amount"}, else null.
"currency" is transcribed exactly as printed, e.g. "AUD".
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
  const fields = parsed as Record<string, unknown>;
  for (const key of FIELDS) {
    const value = fields[key];
    if (
      typeof value === "string" &&
      /^(?:null|none|n\/a|not provided|not present)$/i.test(value.trim())
    ) {
      fields[key] = null;
    }
  }
  return fields as DocFields;
}

function normalizeParty(value: string | null): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function trimPartyAddress(value: string | null): string | null {
  if (!value) return null;
  const entity = value.match(
    /^(.+?\b(?:Pty\s+(?:Ltd|Limited)|Ltd|Limited|LLC|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|GmbH|AG|PLC))(?=\s|,|$)/i,
  );
  return entity ? entity[1].trim() : value.trim();
}

function sameParty(valueA: string, valueB: string): boolean {
  const a = normalizeParty(valueA);
  const b = normalizeParty(valueB);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

function repairShiftedParties(docs: Record<DocKey, DocFields>): void {
  for (const document of Object.values(docs)) {
    document.exporter = trimPartyAddress(document.exporter);
    document.consignee = trimPartyAddress(document.consignee);
  }

  for (const key of Object.keys(docs) as DocKey[]) {
    const current = docs[key];
    if (current.consignee !== null || current.exporter === null) continue;
    const others = (Object.keys(docs) as DocKey[])
      .filter((otherKey) => otherKey !== key)
      .map((otherKey) => docs[otherKey]);
    const shifted = normalizeParty(current.exporter);
    const otherConsignees = others
      .map((doc) => normalizeParty(doc.consignee))
      .filter((value): value is string => value !== null);
    const otherExporters = others
      .map((doc) => normalizeParty(doc.exporter))
      .filter((value): value is string => value !== null);
    if (
      shifted !== null &&
      otherConsignees.length > 0 &&
      otherConsignees.every((value) => sameParty(value, shifted)) &&
      otherExporters.every((value) => !sameParty(value, shifted))
    ) {
      current.consignee = current.exporter;
      current.exporter = null;
    }
  }
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
  const documents = Object.fromEntries(entries) as Record<DocKey, DocFields>;
  repairShiftedParties(documents);
  return documents;
}
