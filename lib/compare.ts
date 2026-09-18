import type {
  ComparisonResult,
  DocFields,
  DocKey,
  CheckStatus,
  FieldRow,
  Issue,
} from "./types";
import { DOC_KEYS, DOC_NAMES } from "./types";
import { AHECC_DATASET } from "./ahecc-data";
import {
  normalizeHsCode as normalizeOfficialHsCode,
  validateHsCodes,
} from "./hs-validation";

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

const REQUIRED_DOCS: Partial<Record<keyof DocFields, DocKey[]>> = {
  exporter: ["invoice", "packing_list", "bill_of_lading"],
  consignee: ["invoice", "packing_list", "bill_of_lading"],
  description_of_goods: ["invoice", "packing_list", "bill_of_lading"],
  unit_quantity: ["invoice", "packing_list", "bill_of_lading"],
  number_of_packages: ["packing_list", "bill_of_lading"],
  net_weight_kg: ["packing_list", "bill_of_lading"],
  gross_weight_kg: ["packing_list", "bill_of_lading"],
};

function isPresent(value: unknown): value is string | number {
  return value !== null && value !== undefined && value !== "";
}

function normalize(value: unknown): string | null {
  if (!isPresent(value)) return null;
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCompany(value: unknown): string | null {
  const text = normalize(value);
  if (text === null) return null;
  return text
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function companiesEquivalent(a: unknown, b: unknown): boolean {
  const left = normalizeCompany(a);
  const right = normalizeCompany(b);
  if (left === null || right === null) return false;
  if (left === right) return true;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  return shorter.split(" ").length >= 2 && longer.startsWith(`${shorter} `);
}

function normalizeVessel(value: unknown): string | null {
  const text = normalize(value);
  if (text === null) return null;
  return text
    .replace(/\b(?:voyage|voy|v)\.?\s*[-:]?\s*[a-z0-9-]+\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:mv|m v|ms|m s|ss)\s+/, "");
}

function vesselsEquivalent(a: unknown, b: unknown): boolean {
  const left = normalizeVessel(a);
  const right = normalizeVessel(b);
  if (left === null || right === null) return false;
  return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `);
}

function normalizeHsCode(value: unknown): string | null {
  if (!isPresent(value)) return null;
  return normalizeOfficialHsCode(String(value));
}

function hsValidationMessage(reasons: string[]): string {
  if (reasons.includes("INVALID_FORMAT")) {
    return "HS code must use a valid six-digit HS or eight-digit AHECC format";
  }
  if (reasons.includes("CODES_CONFLICT")) {
    return "HS code differs across documents";
  }
  if (reasons.includes("CODE_MISSING")) {
    return "No HS code was extracted from the documents";
  }
  if (reasons.includes("CODE_NOT_FOUND")) {
    return "HS code was not found in the official AHECC dataset";
  }
  if (reasons.includes("AHECC_EXTENSION_REQUIRED")) {
    return "A six-digit HS code was found; confirm the eight-digit AHECC export item";
  }
  if (reasons.includes("DESCRIPTION_REVIEW")) {
    return "The goods description may not match the official AHECC description";
  }
  return "The HS code needs review";
}

function normalizePort(value: unknown): string | null {
  const text = normalize(value);
  if (text === null) return null;
  return text
    .split(",", 1)[0]
    .replace(/^port of\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const DESCRIPTION_SYNONYMS: Record<string, string> = {
  art: "painting",
  artwork: "painting",
  picture: "painting",
};

function portsEquivalent(a: unknown, b: unknown): boolean {
  const left = normalizePort(a);
  const right = normalizePort(b);
  if (left === null || right === null) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function descriptionTokens(value: unknown): Set<string> {
  const text = normalize(value) ?? "";
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "of",
    "on",
    "the",
    "original",
    "originals",
    "piece",
    "pieces",
    "pc",
    "pcs",
    "unit",
    "units",
    "crated",
    "packed",
    "package",
    "packages",
    "one",
    "two",
    "three",
    "four",
    "five",
  ]);
  const tokens = text
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token) && !stopWords.has(token))
    .map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
    )
    .map((token) => DESCRIPTION_SYNONYMS[token] ?? token);
  return new Set(tokens);
}

function descriptionsEquivalent(a: unknown, b: unknown): boolean {
  if (similarity(a, b) >= 0.8) return true;
  const left = descriptionTokens(a);
  const right = descriptionTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  const jaccard = intersection / union;
  const smallerCoverage = intersection / Math.min(left.size, right.size);
  return jaccard >= 0.6 || smallerCoverage >= 0.8 || (intersection >= 2 && smallerCoverage >= 0.66);
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
    return descriptionsEquivalent(a, b);
  }
  if (field === "exporter" || field === "consignee") {
    return companiesEquivalent(a, b);
  }
  if (field === "vessel") {
    return vesselsEquivalent(a, b);
  }
  if (field === "port_of_loading" || field === "port_of_discharge") {
    return portsEquivalent(a, b);
  }
  if (field === "hs_code") {
    return normalizeHsCode(a) === normalizeHsCode(b);
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
  return normalize(a) === normalize(b);
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
  const hsValidation = validateHsCodes(docs, AHECC_DATASET);

  if (hsValidation.status !== "passed") {
    const detail = Object.fromEntries(
      DOC_KEYS.map((key) => [
        DOC_NAMES[key],
        hsValidation.rawCodes[key] ?? "Missing",
      ]),
    );
    detail["Official AHECC"] = hsValidation.officialCode
      ? `${hsValidation.officialCode} — ${hsValidation.officialDescription}`
      : hsValidation.exists === false
        ? "Not found"
        : "Not available";
    detail["Dataset"] =
      `${hsValidation.dataset.title} · updated ${hsValidation.dataset.updatedAt}`;

    issues.push({
      status: hsValidation.status,
      field: "HS code",
      message: hsValidationMessage(hsValidation.reasons),
      detail,
    });
  }

  // Required-field coverage. A field is only considered missing on document
  // types where it is expected, so invoice-only values do not create noise.
  for (const [field, requiredDocs] of Object.entries(REQUIRED_DOCS) as [
    keyof DocFields,
    DocKey[],
  ][]) {
    const missing = requiredDocs.filter((key) => !isPresent(docs[key][field]));
    if (missing.length === 0) continue;
    issues.push({
      status: "review",
      field: LABELS[field],
      message: `${LABELS[field]} is missing from ${missing
        .map((key) => DOC_NAMES[key])
        .join(", ")}`,
      detail: Object.fromEntries(
        requiredDocs.map((key) => [
          DOC_NAMES[key],
          isPresent(docs[key][field]) ? String(docs[key][field]) : "Missing",
        ]),
      ),
    });
  }

  // Company names ignore casing, punctuation and whitespace. Close-but-not-
  // equivalent names require review; clearly different entities are errors.
  for (const field of ["exporter", "consignee"] as const) {
    const valuesByDoc = presentDocs(docs, field);
    const entries = Object.values(valuesByDoc).map(String);
    if (entries.length < 2) continue;
    if (entries.every((value) => companiesEquivalent(entries[0], value))) {
      continue;
    }
    const reference = entries[0];
    const looksLikeTypo = entries.every(
      (value) => similarity(normalizeCompany(reference), normalizeCompany(value)) >= 0.9,
    );
    issues.push({
      status: looksLikeTypo ? "review" : "must_fix",
      field: LABELS[field],
      message: `${LABELS[field]} differs across documents${
        looksLikeTypo ? " (looks like a minor typo)" : ""
      }`,
      detail: toDetail(valuesByDoc),
    });
  }

  // Quantity differences are material shipment discrepancies.
  const quantities = presentDocs(docs, "unit_quantity");
  if (
    new Set(Object.values(quantities).map(Number).map(round2)).size > 1
  ) {
    issues.push({
      status: "must_fix",
      field: "Unit quantity",
      message: "Quantity does not match",
      detail: toDetail(quantities),
    });
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
      status: "must_fix",
      field: "No. of packages",
      message: "Package count does not match",
      detail: toDetail(raw),
    });
  }

  // 3. Net and gross weight (packing list vs bill of lading).
  for (const field of ["net_weight_kg", "gross_weight_kg"] as const) {
    const weights = presentDocs(docs, field);
    if (new Set(Object.values(weights).map(Number).map(round2)).size <= 1) {
      continue;
    }
    const formatted: Partial<Record<DocKey, string | number>> = {};
    for (const [key, value] of Object.entries(weights)) {
      formatted[key as DocKey] = `${formatKg(Number(value))} kg`;
    }
    issues.push({
      status: "review",
      field: LABELS[field],
      message: `${field === "gross_weight_kg" ? "Gross" : "Net"} weight does not match`,
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
      status: "review",
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
        status: "must_fix",
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
      status: "must_fix",
      field: "Currency",
      message: "Currency does not match",
      detail: toDetail(currencies),
    });
  }

  // 6. Painting support material (linen / canvas / paper...).
  const MATERIALS = [
    "linen",
    "canvas",
    "paper",
    "silk",
    "cotton",
    "board",
    "ceramic",
    "wood",
    "metal",
    "glass",
    "plastic",
  ];
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
      status: "review",
      field: "Description of goods",
      message: "Product material does not match",
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
    if (present.length === 0 && field !== "hs_code") continue;

    const base = present[0];
    let consistent: boolean;
    if (field === "hs_code") {
      consistent = hsValidation.status === "passed";
    } else if (field === "description_of_goods") {
      consistent = present.every((v) => descriptionsEquivalent(base, v));
    } else if (
      ["gross_weight_kg", "net_weight_kg", "total_amount", "unit_quantity"].includes(field)
    ) {
      consistent =
        new Set(present.map((v) => round2(Number(v)))).size === 1;
    } else if (field === "number_of_packages") {
      consistent = new Set(present.map((v) => firstInt(v))).size === 1;
    } else if (field === "incoterms") {
      consistent = new Set(present.map((v) => incotermCode(v))).size === 1;
    } else if (field === "exporter" || field === "consignee") {
      consistent = present.every((v) => companiesEquivalent(base, v));
    } else if (field === "vessel") {
      consistent = present.every((v) => vesselsEquivalent(base, v));
    } else if (field === "port_of_loading" || field === "port_of_discharge") {
      consistent = present.every((v) => portsEquivalent(base, v));
    } else {
      consistent = present.every((v) => similarity(base, v) >= 0.999);
    }

    const label = LABELS[field] ?? field;
    const issue = issues.find((i) => i.field === label);
    if (issue) consistent = false;
    const status: CheckStatus = issue
      ? issue.status
      : consistent
        ? "passed"
        : "review";

    const presentEntries = DOC_KEYS.map((key) => ({
      key,
      value: docs[key][field],
    })).filter(
      (entry): entry is { key: DocKey; value: string | number } =>
        isPresent(entry.value),
    );
    const { outliers: valueOutliers, reference } = consistent
      ? { outliers: [], reference: null }
      : analyzeValues(field, presentEntries);
    const missingOutliers = (REQUIRED_DOCS[field] ?? []).filter(
      (key) => !isPresent(docs[key][field]),
    );
    const hsMissingOutliers =
      field === "hs_code" && hsValidation.reasons.includes("CODE_MISSING")
        ? DOC_KEYS
        : [];
    const outliers = [
      ...new Set([
        ...valueOutliers,
        ...missingOutliers,
        ...hsMissingOutliers,
      ]),
    ];
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

  return { documents: docs, issues, rows, hsValidation };
}
