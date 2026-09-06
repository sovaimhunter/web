import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckStatus, DocFields, DocKey } from "../../lib/types";

export type StoredStatus = CheckStatus | "match" | "mismatch";

export type ReliabilityScenario = {
  id: string;
  name: string;
  purpose: string;
  documents: Record<DocKey, DocFields>;
  expected: Partial<Record<keyof DocFields, StoredStatus>>;
};

export type ReliabilityManifest = {
  version: number;
  scenario_count: number;
  scenarios: ReliabilityScenario[];
};

export const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

export const SCENARIO_FILE_NAMES: Record<DocKey, string> = {
  invoice: "01_commercial_invoice.pdf",
  packing_list: "02_packing_list.pdf",
  bill_of_lading: "03_bill_of_lading.pdf",
};

export function loadManifest(): ReliabilityManifest {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_ROOT, "scenarios.json"), "utf8"),
  ) as ReliabilityManifest;
}

export function fixturePath(...parts: string[]): string {
  return path.join(FIXTURE_ROOT, ...parts);
}

export function minimalPdfFile(name = "document.pdf"): File {
  const bytes = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
  );
  return new File([bytes], name, {
    type: "application/pdf",
  });
}

export function scenarioFiles(
  scenarioId = "01-clean-baseline",
): Record<DocKey, File> {
  return Object.fromEntries(
    (Object.entries(SCENARIO_FILE_NAMES) as [DocKey, string][]).map(
      ([key, name]) => [key, minimalPdfFile(`${scenarioId}-${name}`)],
    ),
  ) as Record<DocKey, File>;
}
