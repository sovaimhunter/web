import type { DocFields, LineItem } from "../types";

/**
 * Strong-typed core of a single extracted document.
 *
 * These are the fields the system understands well and validates at runtime.
 * They are NOT tied to any document type: any uploaded file may surface any
 * subset of them (absent fields are null). Fields outside this core are kept
 * dynamically in `extra`, so extraction stays open-ended even though the common
 * fields are strictly typed.
 *
 * Per the agreed design: the TYPE lives here (code, compile-time); the
 * risk / importance / guidance metadata lives in the document-consistency Skill.
 */
export type CoreFields = DocFields;
export type { LineItem } from "../types";

export const CORE_FIELD_NAMES = [
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

export type CoreFieldName = (typeof CORE_FIELD_NAMES)[number];

const STRING_FIELDS: readonly CoreFieldName[] = [
  "exporter",
  "consignee",
  "description_of_goods",
  "hs_code",
  "country_of_origin",
  "incoterms",
  "port_of_loading",
  "port_of_discharge",
  "vessel",
  "currency",
];

const STRING_OR_NUMBER_FIELDS: readonly CoreFieldName[] = ["number_of_packages"];

const NUMBER_FIELDS: readonly CoreFieldName[] = [
  "unit_quantity",
  "net_weight_kg",
  "gross_weight_kg",
  "total_amount",
];

export type FieldTypeError = {
  field: CoreFieldName;
  reason: string;
  raw: unknown;
};

export type PartitionedFields = {
  fields: CoreFields;
  extra: Record<string, unknown>;
  errors: FieldTypeError[];
};

/** Source evidence for one normalized field value. */
export type FieldEvidence = {
  rawValue: unknown;
  page?: number;
  quote?: string;
  confidence?: number;
  unit?: string;
};

/** One document after extraction: typed core fields + dynamic extras + provenance. */
export type ExtractedDocument = {
  id: string;
  documentRole?: string | null;
  fields: CoreFields;
  extra: Record<string, unknown>;
  errors: FieldTypeError[];
  evidence?: Record<string, FieldEvidence>;
  provenance: { source: string; at: number };
};

const BLANK_PLACEHOLDER = /^(?:null|none|n\/a|not provided|not present)$/i;

function parseNullableNumber(
  value: unknown,
): { value: number | null; invalid: boolean } {
  if (value === null || value === undefined) {
    return { value: null, invalid: false };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/[,\s]/g, "");
    if (trimmed === "") return { value: null, invalid: false };
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return { value: parsed, invalid: false };
    }
  }
  return { value: null, invalid: true };
}

function parseLineItems(
  value: unknown,
): { items: LineItem[] | null; valid: boolean } {
  if (value === null || value === undefined) {
    return { items: null, valid: true };
  }
  if (!Array.isArray(value)) {
    return { items: null, valid: false };
  }
  const items: LineItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      return { items: null, valid: false };
    }
    const item = raw as Record<string, unknown>;
    const description =
      typeof item.description === "string" ? item.description : null;
    const hsCode = typeof item.hs_code === "string" ? item.hs_code : null;
    const quantity = parseNullableNumber(item.quantity);
    const unitPrice = parseNullableNumber(item.unit_price);
    const amount = parseNullableNumber(item.amount);
    if (quantity.invalid || unitPrice.invalid || amount.invalid) {
      return { items: null, valid: false };
    }
    items.push({
      description,
      ...(Object.prototype.hasOwnProperty.call(item, "hs_code")
        ? { hs_code: hsCode }
        : {}),
      quantity: quantity.value,
      unit_price: unitPrice.value,
      amount: amount.value,
    });
  }
  return { items, valid: true };
}

/**
 * Splits a raw extracted field bag into typed core fields and dynamic extras.
 * Invalid core values are nulled and recorded as errors so the comparison can
 * surface them for human review instead of failing the whole run.
 */
export function partitionExtractedFields(
  raw: Record<string, unknown>,
): PartitionedFields {
  const fields: Record<string, unknown> = Object.fromEntries(
    CORE_FIELD_NAMES.map((name) => [name, null]),
  );
  const extra: Record<string, unknown> = {};
  const errors: FieldTypeError[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!(CORE_FIELD_NAMES as readonly string[]).includes(key)) {
      extra[key] = value;
      continue;
    }
    const name = key as CoreFieldName;

    if (STRING_FIELDS.includes(name)) {
      if (value === null || value === undefined) {
        fields[name] = null;
      } else if (typeof value === "string") {
        fields[name] = BLANK_PLACEHOLDER.test(value.trim()) ? null : value;
      } else {
        errors.push({ field: name, reason: "expected a string", raw: value });
        fields[name] = null;
      }
    } else if (STRING_OR_NUMBER_FIELDS.includes(name)) {
      if (value === null || value === undefined) {
        fields[name] = null;
      } else if (typeof value === "string" || typeof value === "number") {
        fields[name] = value;
      } else {
        errors.push({
          field: name,
          reason: "expected a string or number",
          raw: value,
        });
        fields[name] = null;
      }
    } else if (NUMBER_FIELDS.includes(name)) {
      const parsed = parseNullableNumber(value);
      if (parsed.invalid) {
        errors.push({ field: name, reason: "expected a number", raw: value });
        fields[name] = null;
      } else {
        fields[name] = parsed.value;
      }
    } else if (name === "line_items") {
      const parsed = parseLineItems(value);
      if (!parsed.valid) {
        errors.push({
          field: name,
          reason: "expected an array of line items",
          raw: value,
        });
        fields[name] = null;
      } else {
        fields[name] = parsed.items;
      }
    }
  }

  return { fields: fields as CoreFields, extra, errors };
}
