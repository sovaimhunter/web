import fs from "node:fs";
import path from "node:path";
import { loadDocumentConsistencyCatalog } from "../lib/agent/catalog-file";
import { runFileConsistency } from "../lib/agent/pi/runtime";

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main(): Promise<void> {
  loadEnv(path.resolve(".env.local"));

  const scenarioId = process.argv[2] ?? "01-clean-baseline";
  const root = path.resolve("tests/fixtures/scenarios", scenarioId);
  if (!fs.existsSync(root)) {
    throw new Error(`Unknown PDF scenario: ${scenarioId}`);
  }
  const documents = [
    {
      id: "invoice",
      file: new File(
        [fs.readFileSync(path.join(root, "01_commercial_invoice.pdf"))],
        "invoice.pdf",
        { type: "application/pdf" },
      ),
    },
    {
      id: "packing_list",
      file: new File(
        [fs.readFileSync(path.join(root, "02_packing_list.pdf"))],
        "packing.pdf",
        { type: "application/pdf" },
      ),
    },
    {
      id: "bill_of_lading",
      file: new File(
        [fs.readFileSync(path.join(root, "03_bill_of_lading.pdf"))],
        "bol.pdf",
        { type: "application/pdf" },
      ),
    },
  ];

  const catalog = loadDocumentConsistencyCatalog();

  const { comparison, events, status, missingMaterial } = await runFileConsistency({
    documents,
    catalog,
    onEvent: (event) => {
      if (event.type === "tool_started" || event.type === "tool_completed") {
        console.log(`[${event.type}] ${event.toolName}`);
      }
    },
  });

  console.log("scenario:", scenarioId);
  console.log("status:", status);
  console.log("missing material:", missingMaterial);
  console.log("\nissues:", JSON.stringify(comparison.issues, null, 2));
  console.log(
    "rows:",
    JSON.stringify(
      comparison.rows.map((r) => ({ field: r.field, status: r.status, outliers: r.outliers })),
      null,
      2,
    ),
  );
  console.log("events emitted:", events.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
