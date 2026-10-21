import type { ExtractedDocument } from "./fields";

/**
 * Deterministic cross-field checks. Each rule id corresponds to a
 * `cross_field_rules` entry in the document-consistency Skill. The `check`
 * string in the Skill is human/agent-readable documentation; the executable
 * behaviour lives here and is keyed by the rule id.
 */

export type CrossFieldFinding = {
  values: Record<string, unknown>;
};

export type CrossFieldChecker = (
  doc: ExtractedDocument,
) => CrossFieldFinding | null;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const CROSS_FIELD_CHECKERS: Record<string, CrossFieldChecker> = {
  invoice_total_matches_lines(doc) {
    const { line_items, total_amount } = doc.fields;
    if (!line_items || total_amount === null) return null;
    if (
      line_items.length === 0 ||
      line_items.some(
        (item) => typeof item.amount !== "number" || !Number.isFinite(item.amount),
      )
    ) {
      return null;
    }
    const sum = round2(line_items.reduce((acc, item) => acc + item.amount!, 0));
    if (sum === round2(total_amount)) return null;
    return { values: { "sum of lines": sum, "stated total": total_amount } };
  },

  net_not_over_gross(doc) {
    const { net_weight_kg, gross_weight_kg } = doc.fields;
    if (net_weight_kg === null || gross_weight_kg === null) return null;
    if (net_weight_kg <= gross_weight_kg) return null;
    return {
      values: { "net weight kg": net_weight_kg, "gross weight kg": gross_weight_kg },
    };
  },
};
