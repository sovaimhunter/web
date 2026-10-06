import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAIDocumentSource } from "../lib/agent/openai-extract";

// Minimal .env.local loader (mirrors scripts/scenario-reliability-test.ts).
function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(scriptDir, "../.env.local"));

const fixture = path.resolve(
  scriptDir,
  "../tests/fixtures/scenarios/01-clean-baseline/01_commercial_invoice.pdf",
);
if (!fs.existsSync(fixture)) {
  console.error(`Missing fixture: ${fixture}`);
  process.exit(1);
}

const file = new File(
  [fs.readFileSync(fixture)],
  "01_commercial_invoice.pdf",
  { type: "application/pdf" },
);

async function main(): Promise<void> {
  const source = new OpenAIDocumentSource({ invoice: file });
  const fields = await source.get("invoice");
  console.log(JSON.stringify(fields, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
