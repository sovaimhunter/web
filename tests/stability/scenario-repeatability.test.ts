import { describe, expect, it } from "vitest";
import { compareDocuments } from "../../lib/compare";
import { loadManifest } from "../helpers/fixtures";

const manifest = loadManifest();
const runs = Number(process.env.STABILITY_RUNS ?? 5);

describe(`scenario repeatability (${runs} runs each)`, () => {
  for (const scenario of manifest.scenarios) {
    it(`${scenario.id} produces one stable status signature`, () => {
      const signatures = new Set<string>();
      for (let run = 0; run < runs; run += 1) {
        const result = compareDocuments(structuredClone(scenario.documents));
        signatures.add(
          JSON.stringify(
            result.rows.map((row) => ({ key: row.key, status: row.status })),
          ),
        );
      }
      expect(signatures).toHaveLength(1);
    });
  }
});
