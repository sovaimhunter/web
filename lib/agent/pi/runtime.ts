import { randomUUID } from "node:crypto";
import type { DocumentConsistencyCatalog } from "../catalog";
import {
  compareExtractedDocuments,
  type DynamicComparison,
} from "../compare-dynamic";
import { extractFileTool } from "../file-consistency";
import {
  CORE_FIELD_NAMES,
  type CoreFieldName,
  type ExtractedDocument,
} from "../fields";
import { OpenAIDocumentSource } from "../openai-extract";
import type { AgentEvent } from "../types";
import { mapPiEvent, type AgentEventBody, type PiEvent } from "./events";
import { adaptTool } from "./tools";

export type PiDocument = { id: string; file: File };

export type RunFileConsistencyOptions = {
  documents: PiDocument[];
  catalog: DocumentConsistencyCatalog;
  /** "provider/modelId"; defaults to openai/gpt-4.1-mini. */
  modelId?: string;
  onEvent?: (event: AgentEvent) => void;
};

export type FileConsistencyRunResult = {
  comparison: DynamicComparison;
  events: AgentEvent[];
  status: "complete" | "partial";
  missingMaterial: string[];
};

export type TargetedExtraction = {
  documentId: string;
  fields: CoreFieldName[];
};

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * A missing value is suspicious only when the same configured medium/high-risk
 * field was found in at least two peer documents. One-off fields (for example,
 * an invoice total) do not trigger a retry in unrelated documents.
 */
export function findTargetedExtractions(
  documents: ExtractedDocument[],
  catalog: DocumentConsistencyCatalog,
): TargetedExtraction[] {
  const fields = CORE_FIELD_NAMES.filter((field) => {
    const rule = catalog.fields[field];
    return field !== "line_items" && rule !== undefined && rule.risk !== "low";
  });
  const targets = new Map<string, CoreFieldName[]>();

  for (const field of fields) {
    const presentCount = documents.filter((document) =>
      isPresent(document.fields[field]),
    ).length;
    if (presentCount < 2 || presentCount === documents.length) continue;

    for (const document of documents) {
      if (!isPresent(document.fields[field])) {
        const missing = targets.get(document.id) ?? [];
        missing.push(field);
        targets.set(document.id, missing);
      }
    }
  }

  return [...targets].map(([documentId, targetFields]) => ({
    documentId,
    fields: targetFields,
  }));
}

/** Fill only requested fields that were absent in the first pass. */
export function mergeTargetedExtraction(
  firstPass: ExtractedDocument,
  secondPass: ExtractedDocument,
  requestedFields: CoreFieldName[],
): ExtractedDocument {
  const merged = structuredClone(firstPass);
  for (const field of requestedFields) {
    if (
      !isPresent(firstPass.fields[field]) &&
      isPresent(secondPass.fields[field])
    ) {
      (merged.fields as Record<string, unknown>)[field] =
        secondPass.fields[field];
      const evidence = secondPass.evidence?.[field];
      if (evidence) {
        merged.evidence ??= {};
        merged.evidence[field] = structuredClone(evidence);
      }
    }
  }
  return merged;
}

export function missingDocumentIds(
  expectedIds: string[],
  extractedDocuments: Pick<ExtractedDocument, "id">[],
): string[] {
  const extractedIds = new Set(extractedDocuments.map((document) => document.id));
  return expectedIds.filter((id) => !extractedIds.has(id));
}

/**
 * Runs the file-consistency workflow on the real Pi Agent SDK: the model
 * orchestrates extraction through the `extract_file` tool; the deterministic
 * comparison then runs over the extracted documents and the result is attached
 * to the final `run_completed` event.
 *
 * The SDK is loaded with dynamic import so this module stays loadable from a
 * CommonJS context (the SDK ships ESM-only).
 */
export async function runFileConsistency(
  options: RunFileConsistencyOptions,
): Promise<FileConsistencyRunResult> {
  const modelId = options.modelId ?? "openai/gpt-4.1-mini";
  const [provider, id] = modelId.split("/");

  const [{ createAgentSession, defineTool, ModelRuntime, SessionManager }, { Type }] =
    await Promise.all([
      import("@earendil-works/pi-coding-agent"),
      import("typebox"),
    ]);

  const source = new OpenAIDocumentSource(
    Object.fromEntries(options.documents.map((d) => [d.id, d.file])),
  );
  const adapted = adaptTool("extract_file", extractFileTool(source));
  const toolDef = defineTool({
    name: "extract_file",
    label: "Extract file",
    description:
      "Extract structured fields from one export document by file id. Returns a flat JSON object of fields.",
    parameters: Type.Object({ file: Type.String() }),
    execute: (toolCallId, params, signal) =>
      adapted(toolCallId, params as Record<string, unknown>, signal),
  });

  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(provider, id);
  if (!model) throw new Error(`Model not found: ${modelId}`);

  const { session } = await createAgentSession({
    model,
    modelRuntime,
    sessionManager: SessionManager.inMemory(),
    noTools: "builtin",
    customTools: [toolDef],
    tools: ["extract_file"],
    thinkingLevel: "minimal",
  });

  const runId = randomUUID();
  let sequence = 0;
  const events: AgentEvent[] = [];
  const extracted: ExtractedDocument[] = [];

  const emit = (body: AgentEventBody): void => {
    const event = { ...body, runId, sequence, timestamp: Date.now() } as AgentEvent;
    sequence += 1;
    events.push(event);
    options.onEvent?.(event);
  };

  session.subscribe((event) => {
    for (const body of mapPiEvent(event as unknown as PiEvent)) {
      if (body.type === "run_completed") continue; // deferred until after comparison
      if (body.type === "observation_added") {
        const doc = body.observation as ExtractedDocument | null;
        if (
          doc &&
          typeof doc === "object" &&
          typeof doc.id === "string" &&
          "fields" in doc
        ) {
          extracted.push(doc);
        }
      }
      emit(body);
    }
  });

  emit({ type: "run_started" });

  const fileIds = options.documents.map((d) => d.id).join(", ");
  await session.prompt(
    `Extract fields from each file by calling extract_file once per id: ${fileIds}. Then reply DONE.`,
  );
  await session.waitForIdle();
  session.dispose();

  const documentsById = new Map(extracted.map((document) => [document.id, document]));
  let uniqueDocuments = [...documentsById.values()];
  const targetedTool = extractFileTool(source);

  // The initial model-driven pass is complete before this bounded recovery
  // step begins. Each document appears at most once in the target list, so the
  // same PDF can never receive more than one targeted second pass per run.
  for (const target of findTargetedExtractions(uniqueDocuments, options.catalog)) {
    const toolCallId = randomUUID();
    const intent = {
      name: "extract_file",
      arguments: { file: target.documentId, fields: target.fields },
    };
    emit({ type: "decision_made", decision: { kind: "call_tool", intent } });
    emit({
      type: "tool_started",
      toolCallId,
      toolName: "extract_file",
    });
    const startedAt = Date.now();
    try {
      const secondPass = (await targetedTool.execute(
        intent,
        new AbortController().signal,
      )) as ExtractedDocument;
      const firstPass = documentsById.get(target.documentId);
      if (!firstPass) continue;
      const merged = mergeTargetedExtraction(
        firstPass,
        secondPass,
        target.fields,
      );
      documentsById.set(target.documentId, merged);
      emit({
        type: "tool_completed",
        toolCallId,
        toolName: "extract_file",
        status: "success",
        result: merged,
        durationMs: Date.now() - startedAt,
      });
      emit({
        type: "observation_added",
        name: "extract_file",
        observation: merged,
      });
    } catch (error) {
      // Keep the first pass intact. The failed attempt remains observable in
      // the event log and is not retried again in this run.
      emit({
        type: "tool_completed",
        toolCallId,
        toolName: "extract_file",
        status: "error",
        error: {
          code: "runtime_error",
          message: error instanceof Error ? error.message : "Targeted extraction failed",
        },
        durationMs: Date.now() - startedAt,
      });
    }
  }

  uniqueDocuments = [...documentsById.values()];
  const expectedIds = options.documents.map((document) => document.id);
  const missingMaterial = missingDocumentIds(expectedIds, uniqueDocuments);
  const status = missingMaterial.length === 0 ? "complete" : "partial";
  const comparison = compareExtractedDocuments(uniqueDocuments, options.catalog);
  emit({
    type: "run_completed",
    status,
    result: comparison,
    ...(missingMaterial.length > 0 ? { missingMaterial } : {}),
  });
  return { comparison, events, status, missingMaterial };
}
