import type {
  AheccDataset,
  DocFields,
  DocKey,
  HsCodeScope,
  HsCodeValidation,
  HsValidationReason,
} from "./types";
import { DOC_KEYS } from "./types";

export type {
  AheccDataset,
  HsCodeScope,
  HsCodeValidation,
  HsValidationReason,
} from "./types";

type ParsedCode = {
  raw: string;
  normalized: string | null;
  valid: boolean;
};

const DESCRIPTION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "other",
  "the",
  "to",
  "with",
  "without",
  "entirely",
  "executed",
  "original",
  "originals",
  "goods",
  "item",
  "items",
  "product",
  "products",
]);

function datasetMetadata(
  dataset: AheccDataset,
): Omit<AheccDataset, "entries"> {
  return {
    id: dataset.id,
    title: dataset.title,
    hsEdition: dataset.hsEdition,
    effectiveFrom: dataset.effectiveFrom,
    updatedAt: dataset.updatedAt,
    sourceUrl: dataset.sourceUrl,
    sourceChecksum: dataset.sourceChecksum,
  };
}

function parseCode(value: string): ParsedCode {
  const raw = value.trim();
  const normalized = raw.replace(/[.\s-]/g, "");
  const valid = /^\d+$/.test(normalized) && [6, 8].includes(normalized.length);
  return {
    raw,
    normalized: valid ? normalized : null,
    valid,
  };
}

export function normalizeHsCode(value: string): string | null {
  return parseCode(value).normalized;
}

function descriptionTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !/^\d+$/.test(token))
      .map((token) =>
        token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
      )
      .filter((token) => !DESCRIPTION_STOP_WORDS.has(token)),
  );
}

function descriptionsCompatible(
  documents: Record<DocKey, DocFields>,
  officialDescription: string,
): boolean | null {
  const documentTokens = new Set(
    DOC_KEYS.flatMap((key) =>
      documents[key].description_of_goods
        ? [...descriptionTokens(documents[key].description_of_goods)]
        : [],
    ),
  );
  const officialTokens = descriptionTokens(officialDescription);
  if (documentTokens.size === 0 || officialTokens.size === 0) return null;
  return [...documentTokens].some((token) => officialTokens.has(token));
}

function codesConflict(codes: string[]): boolean {
  const unique = [...new Set(codes)];
  if (unique.length <= 1) return false;

  const sixDigit = unique.filter((code) => code.length === 6);
  const eightDigit = unique.filter((code) => code.length === 8);
  if (sixDigit.length === 0 || eightDigit.length === 0) return true;
  if (new Set(eightDigit).size > 1) return true;

  const prefix = eightDigit[0].slice(0, 6);
  return sixDigit.some((code) => code !== prefix);
}

export function validateHsCodes(
  documents: Record<DocKey, DocFields>,
  dataset: AheccDataset,
): HsCodeValidation {
  const rawCodes: Partial<Record<DocKey, string>> = {};
  const parsedCodes: Partial<Record<DocKey, ParsedCode>> = {};

  for (const key of DOC_KEYS) {
    const value = documents[key].hs_code;
    if (typeof value !== "string" || value.trim() === "") continue;
    rawCodes[key] = value;
    parsedCodes[key] = parseCode(value);
  }

  const metadata = datasetMetadata(dataset);
  const parsed = Object.values(parsedCodes);
  if (parsed.length === 0) {
    return {
      status: "review",
      scope: "none",
      rawCodes,
      normalizedCodes: {},
      normalizedCode: null,
      exists: null,
      officialCode: null,
      officialDescription: null,
      unitOfQuantity: null,
      reasons: ["CODE_MISSING"],
      dataset: metadata,
    };
  }

  const normalizedCodes = Object.fromEntries(
    Object.entries(parsedCodes)
      .filter((entry): entry is [string, ParsedCode] => entry[1] !== undefined)
      .filter(([, value]) => value.normalized !== null)
      .map(([key, value]) => [key, value.normalized]),
  ) as Partial<Record<DocKey, string>>;

  if (parsed.some((value) => !value.valid)) {
    return {
      status: "must_fix",
      scope: "invalid",
      rawCodes,
      normalizedCodes,
      normalizedCode: null,
      exists: null,
      officialCode: null,
      officialDescription: null,
      unitOfQuantity: null,
      reasons: ["INVALID_FORMAT"],
      dataset: metadata,
    };
  }

  const codes = Object.values(normalizedCodes) as string[];
  const lengths = new Set(codes.map((code) => code.length));
  const scope: HsCodeScope =
    lengths.size > 1 ? "mixed" : codes[0].length === 8 ? "ahecc" : "hs";

  if (codesConflict(codes)) {
    return {
      status: "must_fix",
      scope,
      rawCodes,
      normalizedCodes,
      normalizedCode: null,
      exists: null,
      officialCode: null,
      officialDescription: null,
      unitOfQuantity: null,
      reasons: ["CODES_CONFLICT"],
      dataset: metadata,
    };
  }

  const eightDigitCode = codes.find((code) => code.length === 8);
  const normalizedCode = eightDigitCode ?? codes[0];
  const matches = eightDigitCode
    ? dataset.entries.filter((entry) => entry.code === eightDigitCode)
    : dataset.entries.filter((entry) => entry.code.startsWith(codes[0]));
  const official = matches.length === 1 ? matches[0] : null;

  if (matches.length === 0) {
    return {
      status: "review",
      scope,
      rawCodes,
      normalizedCodes,
      normalizedCode,
      exists: false,
      officialCode: null,
      officialDescription: null,
      unitOfQuantity: null,
      reasons: ["CODE_NOT_FOUND"],
      dataset: metadata,
    };
  }

  const reasons: HsValidationReason[] = [];
  if (scope !== "ahecc") reasons.push("AHECC_EXTENSION_REQUIRED");

  if (official) {
    const compatible = descriptionsCompatible(
      documents,
      official.description,
    );
    if (compatible === null) reasons.push("DESCRIPTION_UNAVAILABLE");
    if (compatible === false) reasons.push("DESCRIPTION_REVIEW");
  }

  return {
    status: reasons.length > 0 ? "review" : "passed",
    scope,
    rawCodes,
    normalizedCodes,
    normalizedCode,
    exists: true,
    officialCode: official?.code ?? normalizedCode.slice(0, 6),
    officialDescription:
      official?.description ??
      `${matches.length} AHECC items use this six-digit HS subheading`,
    unitOfQuantity: official?.unitOfQuantity ?? null,
    reasons,
    dataset: metadata,
  };
}
