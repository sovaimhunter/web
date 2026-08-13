import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareDocuments } from "../lib/compare";
import { extractAll } from "../lib/extract";
import {
  DOC_KEYS,
  type DocFields,
  type DocKey,
  type FieldStatus,
} from "../lib/types";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const testDataRoot = path.resolve(scriptDir, "../../test-data/sets");

const FILE_NAMES: Record<DocKey, string> = {
  invoice: "01_invoice.pdf",
  packing_list: "02_packing_list.pdf",
  bill_of_lading: "03_bill_of_lading.pdf",
};

type PlantedError = { key: keyof DocFields; expected: FieldStatus };

const SETS: { id: string; errors: PlantedError[] }[] = [
  {
    id: "set-a",
    errors: [
      { key: "consignee", expected: "mismatch" },
      { key: "number_of_packages", expected: "mismatch" },
      { key: "gross_weight_kg", expected: "review" },
      { key: "description_of_goods", expected: "review" },
    ],
  },
  {
    id: "set-b",
    errors: [
      { key: "total_amount", expected: "mismatch" },
      { key: "port_of_discharge", expected: "review" },
      { key: "incoterms", expected: "review" },
    ],
  },
  {
    id: "set-c",
    errors: [
      { key: "hs_code", expected: "review" },
      { key: "unit_quantity", expected: "review" },
      { key: "net_weight_kg", expected: "review" },
      { key: "country_of_origin", expected: "review" },
      { key: "currency", expected: "mismatch" },
    ],
  },
];

function loadEnv(file: string): void {
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

async function runOnce(
  setDir: string,
): Promise<Map<keyof DocFields, FieldStatus | undefined>> {
  const files = {} as Record<DocKey, File>;
  for (const key of DOC_KEYS) {
    const name = FILE_NAMES[key];
    const buffer = fs.readFileSync(path.join(setDir, name));
    files[key] = new File([buffer], name, { type: "application/pdf" });
  }
  const docs = await extractAll(files);
  const result = compareDocuments(docs);
  return new Map(result.rows.map((row) => [row.key as keyof DocFields, row.status]));
}

async function main(): Promise<void> {
  loadEnv(path.resolve(".env.local"));
  const runs = Number(process.env.RUNS ?? 2);

  let totalPlanted = 0;
  let totalDetected = 0;
  let totalExact = 0;

  for (const set of SETS) {
    const setDir = path.join(testDataRoot, set.id);
    const perError: Record<string, { detected: number; exact: number }> = {};

    for (let run = 1; run <= runs; run++) {
      process.stdout.write(`Running ${set.id} (${run}/${runs})…\n`);
      const statuses = await runOnce(setDir);
      for (const planted of set.errors) {
        const record = (perError[planted.key] ??= { detected: 0, exact: 0 });
        const actual = statuses.get(planted.key);
        if (actual && actual !== "match") record.detected += 1;
        if (actual === planted.expected) record.exact += 1;
      }
    }

    console.log(`\n== ${set.id} ==`);
    for (const planted of set.errors) {
      const record = perError[planted.key];
      console.log(
        `${planted.key.padEnd(24)} expected=${planted.expected.padEnd(8)} ` +
          `detected=${record.detected}/${runs} exact=${record.exact}/${runs}`,
      );
      totalPlanted += 1;
      totalDetected += record.detected;
      totalExact += record.exact;
    }
  }

  console.log(
    `\n=== OVERALL ===\n` +
      `planted errors: ${totalPlanted} × ${runs} runs = ${totalPlanted * runs}\n` +
      `detected (non-match): ${totalDetected}/${totalPlanted * runs} ` +
      `(${((totalDetected / (totalPlanted * runs)) * 100).toFixed(0)}%)\n` +
      `exact severity match: ${totalExact}/${totalPlanted * runs} ` +
      `(${((totalExact / (totalPlanted * runs)) * 100).toFixed(0)}%)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
