import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareDocuments } from "../lib/compare";
import { normalizeCheckStatus } from "../lib/check-status";
import type { CheckStatus, DocFields, DocKey } from "../lib/types";

type StoredStatus = CheckStatus | "match" | "mismatch";

type Scenario = {
  id: string;
  name: string;
  purpose: string;
  documents: Record<DocKey, DocFields>;
  expected: Partial<Record<keyof DocFields, StoredStatus>>;
};

type Manifest = {
  version: number;
  scenario_count: number;
  scenarios: Scenario[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(scriptDir, "../../test-data/scenarios.json");

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

function main(): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  let passedScenarios = 0;
  let planted = 0;
  let detected = 0;
  let exact = 0;
  let falsePositives = 0;
  const failures: string[] = [];

  for (const scenario of manifest.scenarios) {
    const result = compareDocuments(scenario.documents);
    const actual = new Map(result.rows.map((row) => [row.key as keyof DocFields, row.status]));
    const fields = new Set<keyof DocFields>([
      ...actual.keys(),
      ...(Object.keys(scenario.expected) as (keyof DocFields)[]),
    ]);
    const scenarioFailures: string[] = [];

    for (const field of fields) {
      const expected = normalizeCheckStatus(
        scenario.expected[field],
        "passed",
      );
      const observed = actual.get(field);
      if (expected !== "passed") {
        planted += 1;
        if (observed && observed !== "passed") detected += 1;
        if (observed === expected) exact += 1;
      } else if (observed && observed !== "passed") {
        falsePositives += 1;
      }
      if (observed !== expected) {
        scenarioFailures.push(`${String(field)} expected=${expected} actual=${observed ?? "missing-row"}`);
      }
    }

    const passed = scenarioFailures.length === 0;
    if (passed) passedScenarios += 1;
    else failures.push(...scenarioFailures.map((failure) => `${scenario.id}: ${failure}`));
    console.log(`${passed ? "PASS" : "FAIL"}  ${scenario.id.padEnd(36)} ${scenario.name}`);
    for (const failure of scenarioFailures) console.log(`      ${failure}`);
  }

  console.log(
    `\n=== RULE RELIABILITY SUMMARY ===\n` +
      `scenarios passed: ${passedScenarios}/${manifest.scenarios.length} (${percent(passedScenarios, manifest.scenarios.length)})\n` +
      `planted issues detected: ${detected}/${planted} (${percent(detected, planted)})\n` +
      `exact severity: ${exact}/${planted} (${percent(exact, planted)})\n` +
      `false positives: ${falsePositives}\n`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

main();
