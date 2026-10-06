import { describe, expect, it } from "vitest";
import { parseCatalog } from "../../lib/agent/catalog";
import { loadDocumentConsistencyCatalog } from "../../lib/agent/catalog-file";
import { compareExtractedDocuments } from "../../lib/agent/compare-dynamic";
import { Core } from "../../lib/agent/core";
import {
  compareFieldsTool,
  extractFileTool,
  FileConsistencyPolicyModel,
  fileConsistencyTask,
  InMemoryDocumentSource,
  type FileConsistencyVerdict,
  type DocumentSource,
  type RawFieldBag,
} from "../../lib/agent/file-consistency";
import {
  partitionExtractedFields,
  type ExtractedDocument,
} from "../../lib/agent/fields";
import {
  InMemoryAgentRuntime,
  InMemoryRunLog,
  InMemorySessionStore,
  ToolRegistry,
} from "../../lib/agent/runtime";
import type { AgentEvent } from "../../lib/agent/types";

const catalogFromProject = loadDocumentConsistencyCatalog();

async function runAgent(material: Record<string, RawFieldBag>) {
  const catalog = catalogFromProject;
  const task = fileConsistencyTask("consistency-check", Object.keys(material));
  const runtime = new InMemoryAgentRuntime({
    core: new Core(new FileConsistencyPolicyModel()),
    tools: new ToolRegistry(
      new Map([
        ["extract_file", extractFileTool(new InMemoryDocumentSource(material))],
        ["compare_fields", compareFieldsTool(catalog)],
      ]),
    ),
    sessions: new InMemorySessionStore(),
    runLog: new InMemoryRunLog(),
    budget: { maxIterations: 50, maxToolCalls: 50, maxRetries: 0, timeoutMs: 5000 },
    model: "policy-fake",
  });

  const events: AgentEvent[] = [];
  for await (const event of runtime.run(task)) events.push(event);

  // Drive to completion by auto-answering any human-review questions that
  // pause the run mid-check (the comparison result is unaffected by answers).
  while (!events.some((e) => e.type === "run_completed")) {
    const asked = events.filter((e) => e.type === "human_input_requested").length;
    const answered = events.filter((e) => e.type === "human_input_received").length;
    if (asked <= answered) break;
    const runId = events.find((e) => e.type === "run_started")!.runId;
    for await (const event of runtime.resume(runId, "confirmed")) {
      events.push(event);
    }
  }

  const completed = events.find((e) => e.type === "run_completed");
  if (!completed || completed.type !== "run_completed") {
    throw new Error("run did not complete");
  }
  return {
    events,
    verdict: completed.result as FileConsistencyVerdict,
    catalog,
  };
}

function directCompare(
  material: Record<string, RawFieldBag>,
  catalog: ReturnType<typeof parseCatalog>,
) {
  const documents = Object.entries(material).map(([id, raw]) => {
    const { fields, extra, errors } = partitionExtractedFields(raw);
    return {
      id,
      fields,
      extra,
      errors,
      provenance: { source: "test", at: 0 },
    } as ExtractedDocument;
  });
  return compareExtractedDocuments(documents, catalog);
}

describe("dynamic file-consistency agent", () => {
  it("passes requested fields to the document source", async () => {
    const calls: Array<{ id: string; fields?: string[] }> = [];
    const source: DocumentSource = {
      async get(id, fields) {
        calls.push({ id, fields });
        return { fields: { hs_code: "9701.10" }, source: "test" };
      },
    };

    await extractFileTool(source).execute(
      {
        name: "extract_file",
        arguments: { file: "invoice.pdf", fields: ["hs_code"] },
      },
      new AbortController().signal,
    );

    expect(calls).toEqual([{ id: "invoice.pdf", fields: ["hs_code"] }]);
  });

  it("drives one extract per file, then compares, then responds", async () => {
    const { events } = await runAgent({
      "invoice.pdf": { exporter: "Acme Pty Ltd", currency: "AUD" },
      "packing.pdf": { exporter: "Acme Pty Ltd", currency: "AUD" },
    });

    expect(
      events.filter((e) => e.type === "tool_started").map((e) => e.toolName),
    ).toEqual(["extract_file", "extract_file", "compare_fields"]);
  });

  it("matches the direct dynamic comparison (golden equivalence)", async () => {
    const material: Record<string, RawFieldBag> = {
      "invoice.pdf": {
        exporter: "Acme Pty Ltd",
        currency: "AUD",
        unit_quantity: 3,
      },
      "packing.pdf": {
        exporter: "Acme Pty Ltd",
        currency: "AUD",
        unit_quantity: "3",
        net_weight_kg: 12,
      },
      "bol.pdf": {
        exporter: "Other Co",
        currency: "USD",
        unit_quantity: 3,
      },
    };

    const { verdict, catalog } = await runAgent(material);
    const direct = directCompare(material, catalog);

    expect(verdict.outcome).toBe("completed");
    expect(verdict.comparison.issues).toEqual(direct.issues);
    expect(verdict.comparison.rows).toEqual(direct.rows);
  });

  it("flags high-risk mismatches and leaves single-occurrence fields as display", async () => {
    const material: Record<string, RawFieldBag> = {
      "a.pdf": { exporter: "Acme Pty Ltd", currency: "AUD" },
      "b.pdf": { exporter: "Acme Pty Ltd", currency: "USD", vessel: "MV Star" },
    };

    const { verdict } = await runAgent(material);
    const byField = (field: string) =>
      verdict.comparison.rows.find((r) => r.field === field);

    expect(byField("exporter")?.status).toBe("review"); // needs_human_review
    expect(byField("currency")?.status).toBe("must_fix"); // high risk mismatch
    expect(byField("vessel")?.status).toBe("display"); // only in b
  });

  it("pauses mid-check to ask about a dangerous field and resumes with the answer", async () => {
    const material: Record<string, RawFieldBag> = {
      "a.pdf": { exporter: "Acme Pty Ltd", currency: "AUD" },
      "b.pdf": { exporter: "Other Co", currency: "AUD" },
    };
    const catalog = catalogFromProject;
    const task = fileConsistencyTask("check", Object.keys(material));
    const runtime = new InMemoryAgentRuntime({
      core: new Core(new FileConsistencyPolicyModel()),
      tools: new ToolRegistry(
        new Map([
          ["extract_file", extractFileTool(new InMemoryDocumentSource(material))],
          ["compare_fields", compareFieldsTool(catalog)],
        ]),
      ),
      sessions: new InMemorySessionStore(),
      runLog: new InMemoryRunLog(),
      budget: { maxIterations: 50, maxToolCalls: 50, maxRetries: 0, timeoutMs: 5000 },
      model: "policy-fake",
    });

    const first: AgentEvent[] = [];
    for await (const event of runtime.run(task)) first.push(event);

    expect(first.some((e) => e.type === "human_input_requested")).toBe(true);
    expect(first.some((e) => e.type === "run_completed")).toBe(false);

    const runId = first.find((e) => e.type === "run_started")!.runId;
    const second: AgentEvent[] = [];
    for await (const event of runtime.resume(runId, "Acme Pty Ltd")) {
      second.push(event);
    }

    const completed = second.find((e) => e.type === "run_completed");
    const verdict = completed?.result as FileConsistencyVerdict;
    expect(verdict.outcome).toBe("completed");
    expect(verdict.decisions).toEqual([
      { field: "exporter", value: "Acme Pty Ltd" },
    ]);
  });
});
