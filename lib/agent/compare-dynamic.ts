// Dynamic, document-type-agnostic comparison.
//
// Given N extracted documents (each with typed core fields + dynamic extras),
// it aligns fields by name and applies the agreed policy:
//   - a field present in only ONE document is displayed, never flagged;
//   - a field present in >=2 documents is compared (core fields via the
//     deterministic field equivalences in ../compare, extra fields via generic
//     normalization/similarity);
//   - a core value that failed type validation is surfaced for human review.
//
// Step 2a uses a default severity (`review`) for mismatches. Step 2b will read
// risk/importance metadata from the document-consistency Skill to derive
// `must_fix` vs `review` vs `display`.

import { fieldValuesEqual, normalize, similarity } from "../compare";
import type { DocFields } from "../types";
import {
  severityForRisk,
  type DocumentConsistencyCatalog,
} from "./catalog";
import { CROSS_FIELD_CHECKERS } from "./cross-field";
import {
  CORE_FIELD_NAMES,
  type CoreFieldName,
  type ExtractedDocument,
  type FieldEvidence,
} from "./fields";

export type DocId = string;
export type FieldStatus = "passed" | "review" | "must_fix" | "display";
export type FieldKind = "core" | "extra";

const COMPARABLE_CORE_FIELDS = CORE_FIELD_NAMES.filter(
  (name) => name !== "line_items",
);

type ValueEntry = { id: DocId; value: unknown };

export type DynamicRow = {
  field: string;
  kind: FieldKind;
  /** Value per document; null means absent. */
  values: Record<DocId, unknown>;
  presentCount: number;
  status: FieldStatus;
  outliers: DocId[];
  reference: unknown;
};

export type DynamicIssue = {
  field: string;
  status: "must_fix" | "review";
  /** True when a human must confirm this field (Skill `needs_human_review`) or the value failed type validation. */
  needsHumanReview: boolean;
  risk?: "high" | "medium" | "low";
  message: string;
  values: Record<DocId, unknown>;
  /** Extraction evidence keyed by document id, when available. */
  evidence?: Record<DocId, FieldEvidence | null>;
  outliers: DocId[];
  reference: unknown;
};

export type DynamicComparison = {
  documents: ExtractedDocument[];
  issues: DynamicIssue[];
  rows: DynamicRow[];
  /** True when at least one issue requires human confirmation or is a blocker. */
  requiresHumanReview: boolean;
};

function genericEquivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.round(a * 100) === Math.round(b * 100);
  }
  const left = normalize(a);
  const right = normalize(b);
  if (left === null || right === null) return false;
  if (left === right) return true;
  return similarity(a, b) >= 0.8;
}

function coreEquivalent(
  field: CoreFieldName,
  a: unknown,
  b: unknown,
): boolean {
  return fieldValuesEqual(
    field as keyof DocFields,
    a as string | number,
    b as string | number,
  );
}

function analyze(
  entries: ValueEntry[],
  equivalent: (a: unknown, b: unknown) => boolean,
): { reference: unknown; outliers: DocId[] } {
  if (entries.length < 2) {
    return { reference: entries[0]?.value ?? null, outliers: [] };
  }

  const groups: ValueEntry[][] = [];
  for (const entry of entries) {
    const group = groups.find((g) => equivalent(g[0].value, entry.value));
    if (group) group.push(entry);
    else groups.push([entry]);
  }

  const maxSize = Math.max(...groups.map((g) => g.length));
  const largest = groups.find((g) => g.length === maxSize)!;
  const reference = largest[0].value;
  const outliers =
    maxSize === 1
      ? entries.map((e) => e.id)
      : groups
          .filter((g) => g.length < maxSize)
          .flatMap((g) => g.map((e) => e.id));
  return { reference, outliers };
}

export function compareExtractedDocuments(
  documents: ExtractedDocument[],
  catalog?: DocumentConsistencyCatalog,
): DynamicComparison {
  const issues: DynamicIssue[] = [];
  const rows: DynamicRow[] = [];

  // A value that failed type validation is a "needs review" finding on its own,
  // independent of how many documents carried the field.
  for (const doc of documents) {
    for (const error of doc.errors) {
      issues.push({
        field: error.field,
        status: "review",
        needsHumanReview: true,
        risk: catalog?.fields[error.field]?.risk,
        message: `"${error.field}" in ${doc.id} has an unexpected type and needs review`,
        values: { [doc.id]: error.raw },
        evidence: { [doc.id]: doc.evidence?.[error.field] ?? null },
        outliers: [doc.id],
        reference: null,
      });
    }
  }

  const extraFieldNames = [
    ...new Set(documents.flatMap((doc) => Object.keys(doc.extra))),
  ].sort();

  const allFields: Array<{ name: string; kind: FieldKind }> = [
    ...COMPARABLE_CORE_FIELDS.map((name) => ({ name, kind: "core" as const })),
    ...extraFieldNames.map((name) => ({ name, kind: "extra" as const })),
  ];

  for (const { name, kind } of allFields) {
    const values: Record<DocId, unknown> = {};
    const evidence: Record<DocId, FieldEvidence | null> = {};
    const entries: ValueEntry[] = [];

    for (const doc of documents) {
      const value = kind === "core" ? doc.fields[name as CoreFieldName] : doc.extra[name];
      values[doc.id] = value ?? null;
      evidence[doc.id] = doc.evidence?.[name] ?? null;
      if (value !== null && value !== undefined) {
        entries.push({ id: doc.id, value });
      }
    }

    if (entries.length === 0) continue;

    let status: FieldStatus;
    let outliers: DocId[] = [];
    let reference: unknown = null;
    let needsHumanReview = false;
    let risk: "high" | "medium" | "low" | undefined;

    if (entries.length === 1) {
      status = "display";
      reference = entries[0].value;
    } else {
      const equivalent =
        kind === "core"
          ? (a: unknown, b: unknown) =>
              coreEquivalent(name as CoreFieldName, a, b)
          : genericEquivalent;
      const analysis = analyze(entries, equivalent);
      outliers = analysis.outliers;
      reference = analysis.reference;

      const rule =
        kind === "core" ? catalog?.fields[name as CoreFieldName] : undefined;
      risk = rule?.risk;
      if (outliers.length === 0) {
        needsHumanReview = rule?.needsHumanReview ?? false;
        status = needsHumanReview ? "review" : "passed";
      } else {
        const severity = rule ? severityForRisk(rule.risk) : "review";
        status = severity;
        if (severity === "display") outliers = [];
      }
    }

    rows.push({
      field: name,
      kind,
      values,
      presentCount: entries.length,
      status,
      outliers,
      reference,
    });

    if (status === "review" || status === "must_fix") {
      issues.push({
        field: name,
        status: status as "review" | "must_fix",
        needsHumanReview,
        risk,
        message:
          outliers.length === 0
            ? `"${name}" is consistent but needs human review`
            : `"${name}" differs across documents`,
        values,
        evidence,
        outliers,
        reference,
      });
    }
  }

  // Deterministic cross-field checks declared by the Skill.
  if (catalog) {
    for (const rule of catalog.crossFieldRules) {
      const checker = CROSS_FIELD_CHECKERS[rule.id];
      if (!checker) continue;
      for (const doc of documents) {
        const finding = checker(doc);
        if (finding) {
          issues.push({
            field: rule.id,
            status: rule.severity,
            needsHumanReview: false,
            message: rule.description,
            values: { [doc.id]: finding.values },
            outliers: [doc.id],
            reference: null,
          });
        }
      }
    }
  }

  const requiresHumanReview = issues.some(
    (issue) => issue.needsHumanReview || issue.status === "must_fix",
  );
  return { documents, issues, rows, requiresHumanReview };
}
