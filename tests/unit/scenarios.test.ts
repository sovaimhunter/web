import { describe, expect, it } from "vitest";
import { normalizeCheckStatus } from "../../lib/check-status";
import { compareDocuments } from "../../lib/compare";
import type { DocFields } from "../../lib/types";
import {
  loadManifest,
} from "../helpers/fixtures";

const manifest = loadManifest();

describe("15 document consistency scenarios", () => {
  it("contains 15 scenarios and 45 structured document expectations", () => {
    expect(manifest.scenario_count).toBe(15);
    expect(manifest.scenarios).toHaveLength(15);
    for (const scenario of manifest.scenarios) {
      expect(Object.keys(scenario.documents)).toHaveLength(3);
    }
  });

  for (const scenario of manifest.scenarios) {
    it(`${scenario.id}: ${scenario.name}`, () => {
      const result = compareDocuments(structuredClone(scenario.documents));
      const actual = new Map(
        result.rows.map((row) => [row.key as keyof DocFields, row.status]),
      );
      for (const [field, observed] of actual) {
        const expected = normalizeCheckStatus(
          scenario.expected[field],
          "passed",
        );
        expect(observed, `${String(field)} status`).toBe(expected);
      }
      for (const field of Object.keys(scenario.expected) as (keyof DocFields)[]) {
        expect(actual.has(field), `${String(field)} row`).toBe(true);
      }
    });
  }
});
