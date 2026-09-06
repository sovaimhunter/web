import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareDocuments } from "../lib/compare";
import { normalizeCheckStatus } from "../lib/check-status";
import { extractAll } from "../lib/extract";
import {
  DOC_KEYS,
  type DocFields,
  type DocKey,
  type CheckStatus,
} from "../lib/types";

type StoredStatus = CheckStatus | "match" | "mismatch";
type ReliabilityMode = "rules" | "ai";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const testDataRoot = path.resolve(scriptDir, "../tests/fixtures");
const scenarioRoot = path.resolve(
  process.env.PDF_FIXTURE_ROOT ?? path.join(testDataRoot, "scenarios"),
);
const manifestPath = path.join(testDataRoot, "scenarios.json");
const reportRoot = path.resolve("test-results");

const FILE_NAMES: Record<DocKey, string> = {
  invoice: "01_commercial_invoice.pdf",
  packing_list: "02_packing_list.pdf",
  bill_of_lading: "03_bill_of_lading.pdf",
};

const EXTRACTED_FIELDS: (keyof DocFields)[] = [
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
];

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

type RunResult = {
  scenarioId: string;
  scenarioName: string;
  run: number;
  passed: boolean;
  statuses: Record<string, CheckStatus | "missing-row">;
  planted: number;
  detected: number;
  exact: number;
  falsePositives: number;
  failures: string[];
  extractionChecked: number;
  extractionMatched: number;
  extractionMismatches: string[];
  extracted: Record<DocKey, DocFields>;
};

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractionEqual(
  field: keyof DocFields,
  expected: unknown,
  actual: unknown,
): boolean {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined || actual === "";
  }
  if (typeof expected === "number") {
    return typeof actual === "number" && Math.abs(expected - actual) < 0.01;
  }
  if (field === "hs_code") {
    return String(expected).replace(/\D/g, "") === String(actual ?? "").replace(/\D/g, "");
  }
  const expectedText = normalizeText(expected);
  const actualText = normalizeText(actual);
  if (expectedText === actualText) return true;
  if (field === "description_of_goods") {
    return actualText.includes(expectedText) || expectedText.includes(actualText);
  }
  return false;
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

async function runScenario(
  scenario: Scenario,
  run: number,
  mode: ReliabilityMode,
): Promise<RunResult> {
  let extracted: Record<DocKey, DocFields>;
  if (mode === "ai") {
    const scenarioDir = path.join(scenarioRoot, scenario.id);
    if (!fs.existsSync(scenarioDir)) {
      throw new Error(
        `PDF fixtures are not available at ${scenarioRoot}. Restore the ignored local files or set PDF_FIXTURE_ROOT.`,
      );
    }
    const files = {} as Record<DocKey, File>;
    for (const key of DOC_KEYS) {
      const name = FILE_NAMES[key];
      const buffer = fs.readFileSync(path.join(scenarioDir, name));
      files[key] = new File([buffer], name, { type: "application/pdf" });
    }
    extracted = await extractAll(files);
  } else {
    extracted = structuredClone(scenario.documents);
  }
  const comparison = compareDocuments(extracted);
  const actual = new Map(
    comparison.rows.map((row) => [row.key as keyof DocFields, row.status]),
  );
  const fields = new Set<keyof DocFields>([
    ...actual.keys(),
    ...(Object.keys(scenario.expected) as (keyof DocFields)[]),
  ]);
  const statuses: Record<string, CheckStatus | "missing-row"> = {};
  const failures: string[] = [];
  let planted = 0;
  let detected = 0;
  let exact = 0;
  let falsePositives = 0;

  for (const field of fields) {
    const expected = normalizeCheckStatus(
      scenario.expected[field],
      "passed",
    );
    const observed = actual.get(field) ?? "missing-row";
    statuses[String(field)] = observed;
    if (expected !== "passed") {
      planted += 1;
      if (observed !== "passed" && observed !== "missing-row") detected += 1;
      if (observed === expected) exact += 1;
    } else if (observed !== "passed" && observed !== "missing-row") {
      falsePositives += 1;
    }
    if (observed !== expected) {
      failures.push(`${String(field)} expected=${expected} actual=${observed}`);
    }
  }

  let extractionChecked = 0;
  let extractionMatched = 0;
  const extractionMismatches: string[] = [];
  if (mode === "ai") {
    for (const key of DOC_KEYS) {
      for (const field of EXTRACTED_FIELDS) {
        extractionChecked += 1;
        const expected = scenario.documents[key][field];
        const observed = extracted[key][field];
        if (extractionEqual(field, expected, observed)) {
          extractionMatched += 1;
        } else {
          extractionMismatches.push(
            `${key}.${String(field)} expected=${JSON.stringify(expected)} actual=${JSON.stringify(observed)}`,
          );
        }
      }
    }
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    run,
    passed: failures.length === 0,
    statuses,
    planted,
    detected,
    exact,
    falsePositives,
    failures,
    extractionChecked,
    extractionMatched,
    extractionMismatches,
    extracted,
  };
}

function writeReport(
  manifest: Manifest,
  runs: number,
  results: RunResult[],
  mode: ReliabilityMode,
): void {
  fs.mkdirSync(reportRoot, { recursive: true });
  const reportPath = path.join(
    reportRoot,
    `scenario-reliability-${mode}.md`,
  );
  const rawResultsPath = path.join(
    reportRoot,
    `scenario-reliability-${mode}.json`,
  );
  const planted = results.reduce((sum, result) => sum + result.planted, 0);
  const detected = results.reduce((sum, result) => sum + result.detected, 0);
  const exact = results.reduce((sum, result) => sum + result.exact, 0);
  const falsePositives = results.reduce(
    (sum, result) => sum + result.falsePositives,
    0,
  );
  const extractionChecked = results.reduce(
    (sum, result) => sum + result.extractionChecked,
    0,
  );
  const extractionMatched = results.reduce(
    (sum, result) => sum + result.extractionMatched,
    0,
  );

  const lines = [
    "# TradeLynk Scenario Reliability Report",
    "",
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Method:** ${manifest.scenarios.length} scenarios × ${runs} runs = ${results.length} complete checks (${mode === "ai" ? `${results.length * 3} PDF extractions` : "deterministic structured-field validation"}).`,
    "",
    "## Summary",
    "",
    `- Planted issues detected: ${detected}/${planted} (${percent(detected, planted)})`,
    `- Exact severity: ${exact}/${planted} (${percent(exact, planted)})`,
    `- False positives: ${falsePositives}`,
    ...(mode === "ai"
      ? [
          `- Field extraction agreement: ${extractionMatched}/${extractionChecked} (${percent(extractionMatched, extractionChecked)})`,
        ]
      : []),
    "",
    "## Scenario results",
    "",
    "| Scenario | Passed runs | False positives | Repeatable | Notes |",
    "|---|---:|---:|---|---|",
  ];

  for (const scenario of manifest.scenarios) {
    const scenarioResults = results.filter(
      (result) => result.scenarioId === scenario.id,
    );
    const passed = scenarioResults.filter((result) => result.passed).length;
    const fps = scenarioResults.reduce(
      (sum, result) => sum + result.falsePositives,
      0,
    );
    const signatures = new Set(
      scenarioResults.map((result) => JSON.stringify(result.statuses)),
    );
    const repeatable = runs < 2 ? "N/A" : signatures.size === 1 ? "Yes" : "No";
    const notes = [
      ...new Set(
        scenarioResults.flatMap((result) => [
          ...result.failures,
          ...result.extractionMismatches.slice(0, 2),
        ]),
      ),
    ];
    lines.push(
      `| ${scenario.id} | ${passed}/${runs} | ${fps} | ${repeatable} | ${notes.length ? notes.join("; ").replace(/\|/g, "\\|") : "-"} |`,
    );
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "- A planted issue is detected when the final status is `review` or `must_fix`.",
    "- A false positive is any non-passed status on a field expected to pass.",
    "- Repeatable means every run produced the same field-status map for that scenario; reports require at least two runs.",
    "- Extraction agreement is diagnostic only; the final issue metrics remain the product outcome.",
    "",
  );
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  fs.writeFileSync(
    rawResultsPath,
    `${JSON.stringify({ generated_at: new Date().toISOString(), mode, runs, results }, null, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  loadEnv(path.resolve(".env.local"));
  const mode = (process.env.RELIABILITY_MODE ?? "rules") as ReliabilityMode;
  if (mode !== "rules" && mode !== "ai") {
    throw new Error(`Unsupported RELIABILITY_MODE: ${mode}`);
  }
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as Manifest;
  const runs = Number(process.env.RUNS ?? (mode === "ai" ? 3 : 5));
  if (!Number.isInteger(runs) || runs < 2) {
    throw new Error("RUNS must be an integer of at least 2 for repeatability.");
  }
  const results: RunResult[] = [];

  for (const scenario of manifest.scenarios) {
    for (let run = 1; run <= runs; run++) {
      process.stdout.write(
        `Running ${scenario.id} (${run}/${runs})...\n`,
      );
      const result = await runScenario(scenario, run, mode);
      results.push(result);
      process.stdout.write(
        `  ${result.passed ? "PASS" : "FAIL"} ` +
          `detected=${result.detected}/${result.planted} ` +
          `falsePositives=${result.falsePositives}` +
          (mode === "ai"
            ? ` extraction=${result.extractionMatched}/${result.extractionChecked}`
            : "") +
          "\n",
      );
    }
  }

  writeReport(manifest, runs, results, mode);
  const failed = results.filter((result) => !result.passed).length;
  console.log(
    `\nReports written to ${path.join(reportRoot, `scenario-reliability-${mode}.{md,json}`)}`,
  );
  console.log(`Complete checks failed: ${failed}/${results.length}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
