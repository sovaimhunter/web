import type {
  ComparisonResult,
  DocFields,
  DocKey,
  FieldStatus,
  FieldRow,
  Issue,
} from "./types";
import { DOC_KEYS, DOC_NAMES } from "./types";

const LABELS: Record<string, string> = {
  exporter: "Exporter/Shipper",
  consignee: "Importer / Consignee",
  description_of_goods: "Description of goods",
  hs_code: "HS code",
  country_of_origin: "Country of origin",
  incoterms: "Incoterms",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  vessel: "Vessel",
  unit_quantity: "Unit quantity",
  number_of_packages: "No. of packages",
  net_weight_kg: "Net weight (kg)",
  gross_weight_kg: "Gross weight (kg)",
  total_amount: "Invoice value",
  currency: "Currency",
};

const FIELD_ORDER: (keyof DocFields)[] = [
  "exporter",
  "consignee",
  "description_of_goods",
  "hs_code",
  "country_of_origin",
  "unit_quantity",
  "net_weight_kg",
  "gross_weight_kg",
  "currency",
  "total_amount",
  "number_of_packages",
  "incoterms",
  "port_of_loading",
  "port_of_discharge",
  "vessel",
];

function isPresent(value: unknown): value is string | number {
  return value !== null && value !== undefined && value !== "";
}

function normalize(value: unknown): string | null {
  if (!isPresent(value)) return null;
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

// LCS-based similarity ratio (same spirit as Python's difflib.SequenceMatcher).
function similarity(a: unknown, b: unknown): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === null || y === null) return 0;
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;

  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        x[i - 1] === y[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[n][m]) / (n + m);
}

function firstInt(value: unknown): number | null {
  if (!isPresent(value)) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function incotermCode(value: unknown): string | null {
  if (!isPresent(value)) return null;
  const match = /^\s*([A-Za-z]{3})/.exec(String(value));
  return match ? match[1].toUpperCase() : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatKg(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function presentDocs(
  docs: Record<DocKey, DocFields>,
  field: keyof DocFields,
): Partial<Record<DocKey, string | number>> {
  const out: Partial<Record<DocKey, string | number>> = {};
  for (const key of DOC_KEYS) {
    const value = docs[key][field];
    if (isPresent(value)) out[key] = value;
  }
  return out;
}

function toDetail(values: Partial<Record<DocKey, string | number>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      DOC_NAMES[key as DocKey],
      String(value),
    ]),
  );
}

function fieldValuesEqual(
  field: keyof DocFields,
  a: string | number,
  b: string | number,
): boolean {
  if (field === "description_of_goods") {
    return similarity(a, b) >= 0.8;
  }
  if (
    ["gross_weight_kg", "net_weight_kg", "total_amount", "unit_quantity"].includes(
      field,
    )
  ) {
    return round2(Number(a)) === round2(Number(b));
  }
  if (field === "number_of_packages") {
    return firstInt(a) === firstInt(b);
  }
  if (field === "incoterms") {
    return incotermCode(a) === incotermCode(b);
  }
  // Text fields: compare exactly as displayed (whitespace-normalized,
  // case-preserved) so a case typo like "GmbH" vs "Gmbh" is flagged.
  const ws = (s: string) => s.trim().replace(/\s+/g, " ");
  return ws(String(a)) === ws(String(b));
}

function analyzeValues(
  field: keyof DocFields,
  entries: { key: DocKey; value: string | number }[],
): { outliers: DocKey[]; reference: string | number | null } {
  if (entries.length < 2) {
    return { outliers: [], reference: entries[0]?.value ?? null };
  }

  const groups: { key: DocKey; value: string | number }[][] = [];
  for (const entry of entries) {
    const group = groups.find((g) =>
      fieldValuesEqual(field, g[0].value, entry.value),
    );
    if (group) {
      group.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  const maxSize = Math.max(...groups.map((g) => g.length));
  const largestGroup = groups.find((g) => g.length === maxSize)!;
  const reference = largestGroup[0].value;
  const outliers =
    maxSize === 1
      ? entries.map((e) => e.key)
      : groups
          .filter((g) => g.length < maxSize)
          .flatMap((g) => g.map((e) => e.key));
  return { outliers, reference };
}

export function compareDocuments(
  docs: Record<DocKey, DocFields>,
): ComparisonResult {
  const issues: Issue[] = [];

  // 1. Consignee — case-preserved, so "GmbH" vs "Gmbh" is caught.
  const consignees = presentDocs(docs, "consignee");
  if (Object.keys(consignees).length > 1) {
    const values = Object.values(consignees).map(String);
    const base = values[0];
    const ws = (s: string) => s.trim().replace(/\s+/g, " ");
    if (values.some((v) => ws(v) !== ws(base))) {
      const looksLikeTypo = values.every((v) => similarity(base, v) >= 0.85);
      issues.push({
        severity: "error",
        field: "Importer / Consignee",
        message: `Consignee differs across documents${
          looksLikeTypo ? " (looks like a typo)" : ""
        }`,
        detail: toDetail(consignees),
      });
    }
  }

  // 2. Number of packages (packing list vs bill of lading).
  const packageCounts: Partial<Record<DocKey, number | null>> = {};
  for (const key of DOC_KEYS) {
    const raw = docs[key].number_of_packages;
    if (isPresent(raw)) packageCounts[key] = firstInt(raw);
  }
  if (new Set(Object.values(packageCounts)).size > 1) {
    const raw: Partial<Record<DocKey, string | number>> = {};
    for (const key of DOC_KEYS) {
      if (isPresent(docs[key].number_of_packages)) {
        raw[key] = docs[key].number_of_packages;
      }
    }
    issues.push({
      severity: "error",
      field: "No. of packages",
      message: "Package count does not match",
      detail: toDetail(raw),
    });
  }

  // 3. Gross weight (packing list vs bill of lading).
  const grossWeights = presentDocs(docs, "gross_weight_kg");
  if (new Set(Object.values(grossWeights).map(Number).map(round2)).size > 1) {
    const formatted: Partial<Record<DocKey, string | number>> = {};
    for (const [key, value] of Object.entries(grossWeights)) {
      formatted[key as DocKey] = `${formatKg(Number(value))} kg`;
    }
    issues.push({
      severity: "warning",
      field: "Gross weight",
      message: "Gross weight does not match",
      detail: toDetail(formatted),
    });
  }

  // 4. Incoterms (invoice vs bill of lading) — first 3 letters.
  const incoterms = presentDocs(docs, "incoterms");
  const codes = new Set(
    Object.values(incoterms).map((v) => incotermCode(v)),
  );
  if (codes.size > 1) {
    issues.push({
      severity: "warning",
      field: "Incoterms",
      message: "Incoterm does not match",
      detail: toDetail(incoterms),
    });
  }

  // 5. Invoice internal arithmetic.
  const invoice = docs.invoice;
  if (invoice.line_items && invoice.total_amount !== null) {
    const sum = invoice.line_items.reduce(
      (acc, item) => acc + (item.amount ?? 0),
      0,
    );
    if (round2(sum) !== round2(invoice.total_amount)) {
      issues.push({
        severity: "error",
        field: "Invoice value",
        message: "Line items do not sum to the stated total",
        detail: {
          "sum of lines": sum.toLocaleString("en-US"),
          "stated TOTAL": invoice.total_amount.toLocaleString("en-US"),
        },
      });
    }
  }

  // 5b. Currency (any documents that carry it).
  const currencies = presentDocs(docs, "currency");
  const currencyCodes = new Set(
    Object.values(currencies).map((v) =>
      normalize(v)?.toUpperCase() ?? String(v),
    ),
  );
  if (currencyCodes.size > 1) {
    issues.push({
      severity: "error",
      field: "Currency",
      message: "Currency does not match",
      detail: toDetail(currencies),
    });
  }

  // 6. Painting support material (linen / canvas / paper...).
  const MATERIALS = ["linen", "canvas", "paper", "silk", "cotton", "board"];
  const materials: Partial<Record<DocKey, string>> = {};
  for (const key of DOC_KEYS) {
    const description = normalize(docs[key].description_of_goods);
    if (description) {
      const found = MATERIALS.find((m) => description.includes(m));
      if (found) materials[key] = found;
    }
  }
  if (new Set(Object.values(materials)).size > 1) {
    const raw: Partial<Record<DocKey, string | number>> = {};
    for (const key of DOC_KEYS) {
      if (isPresent(docs[key].description_of_goods)) {
        raw[key] = docs[key].description_of_goods;
      }
    }
    issues.push({
      severity: "warning",
      field: "Material",
      message: "Painting support material does not match",
      detail: toDetail(raw),
    });
  }

  // Field-by-field consistency table.
  const rows: FieldRow[] = [];
  for (const field of FIELD_ORDER) {
    const vals = Object.fromEntries(
      DOC_KEYS.map((key) => [key, docs[key][field]]),
    ) as Record<DocKey, string | number | null>;
    const present = Object.values(vals).filter(isPresent);
    if (present.length === 0) continue;

    const base = present[0];
    let consistent: boolean;
    if (field === "description_of_goods") {
      consistent = present.every((v) => similarity(base, v) >= 0.8);
    } else if (
      ["gross_weight_kg", "net_weight_kg", "total_amount", "unit_quantity"].includes(field)
    ) {
      consistent =
        new Set(present.map((v) => round2(Number(v)))).size === 1;
    } else if (field === "number_of_packages") {
      consistent = new Set(present.map((v) => firstInt(v))).size === 1;
    } else if (field === "incoterms") {
      consistent = new Set(present.map((v) => incotermCode(v))).size === 1;
    } else {
      consistent = present.every((v) => similarity(base, v) >= 0.999);
    }

    const label = LABELS[field] ?? field;
    const issue = issues.find((i) => i.field === label);
    if (issue) consistent = false;
    const status: FieldStatus = issue
      ? issue.severity === "error"
        ? "mismatch"
        : "review"
      : consistent
        ? "match"
        : "review";

    const presentEntries = DOC_KEYS.map((key) => ({
      key,
      value: docs[key][field],
    })).filter(
      (entry): entry is { key: DocKey; value: string | number } =>
        isPresent(entry.value),
    );
    const { outliers, reference } = consistent
      ? { outliers: [], reference: null }
      : analyzeValues(field, presentEntries);
    rows.push({
      field: label,
      key: field,
      vals,
      consistent,
      status,
      outliers,
      reference,
    });
  }

  return { documents: docs, issues, rows };
}
