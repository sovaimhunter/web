// Dynamic, document-type-agnostic file-consistency agent workflow.
//
// Tools:
//   extract_file({ file })  -> one ExtractedDocument (typed core + dynamic extras)
//   compare_fields({ documents }) -> DynamicComparison (deterministic)
//
// FileConsistencyPolicyModel is a deterministic stand-in for a real model: it
// drives extract-each-file -> compare -> respond, reading only AgentState. A
// real LLM can replace it later with the same tools and verdict contract.

import type { DocumentConsistencyCatalog } from "./catalog";
import {
  compareExtractedDocuments,
  type DynamicComparison,
  type DynamicIssue,
} from "./compare-dynamic";
import {
  partitionExtractedFields,
  type ExtractedDocument,
  type FieldEvidence,
} from "./fields";
import {
  ToolExecutionError,
  type AgentState,
  type Decision,
  type ModelPort,
  type Task,
  type ToolPort,
} from "./types";

export type RawFieldBag = Record<string, unknown>;

export type DocumentExtraction = {
  fields: RawFieldBag;
  evidence?: Record<string, FieldEvidence>;
  documentRole?: string | null;
  source?: string;
};

export interface DocumentSource {
  get(
    fileId: string,
    requestedFields?: string[],
  ): Promise<DocumentExtraction | undefined>;
}

/** In-memory document source; a real adapter would read PDFs and extract. */
export class InMemoryDocumentSource implements DocumentSource {
  constructor(private readonly material: Record<string, RawFieldBag>) {}

  async get(fileId: string): Promise<DocumentExtraction | undefined> {
    const value = this.material[fileId];
    return value
      ? { fields: structuredClone(value), source: "in-memory" }
      : undefined;
  }
}

/** Atomic read: one file id in, one validated ExtractedDocument out. */
export function extractFileTool(source: DocumentSource): ToolPort {
  return {
    async execute(intent, signal) {
      signal.throwIfAborted();
      const file = intent.arguments.file;
      if (typeof file !== "string" || file === "") {
        throw new ToolExecutionError(
          "extract_file requires a non-empty file id",
          "invalid_tool",
        );
      }
      const requestedFieldsValue = intent.arguments.fields;
      if (
        requestedFieldsValue !== undefined &&
        (!Array.isArray(requestedFieldsValue) ||
          requestedFieldsValue.some(
            (field) => typeof field !== "string" || field.trim() === "",
          ))
      ) {
        throw new ToolExecutionError(
          "extract_file fields must be a string array",
          "invalid_tool",
        );
      }
      const requestedFields = Array.isArray(requestedFieldsValue)
        ? [...new Set(requestedFieldsValue.map((field) => field.trim()))]
        : undefined;
      const extraction = await source.get(file, requestedFields);
      if (!extraction) {
        throw new ToolExecutionError(
          `No material available for file "${file}"`,
          "runtime_error",
        );
      }
      const { fields, extra, errors } = partitionExtractedFields(
        extraction.fields,
      );
      const document: ExtractedDocument = {
        id: file,
        documentRole: extraction.documentRole,
        fields,
        extra,
        errors,
        evidence: extraction.evidence,
        provenance: {
          source: extraction.source ?? "document-source",
          at: Date.now(),
        },
      };
      return document;
    },
  };
}

function toDocuments(value: unknown): ExtractedDocument[] {
  if (!Array.isArray(value)) {
    throw new ToolExecutionError(
      "compare_fields requires a documents array",
      "invalid_tool",
    );
  }
  return value as ExtractedDocument[];
}

/** Atomic, deterministic comparison: documents in, issues/rows out. */
export function compareFieldsTool(
  catalog?: DocumentConsistencyCatalog,
): ToolPort {
  return {
    async execute(intent, signal) {
      signal.throwIfAborted();
      return compareExtractedDocuments(
        toDocuments(intent.arguments.documents),
        catalog,
      );
    },
  };
}

export type FileConsistencyVerdict = {
  outcome: "completed";
  comparison: DynamicComparison;
  decisions: Array<{ field: string; value: unknown }>;
};

function buildQuestion(issue: DynamicIssue): string {
  const values = Object.entries(issue.values)
    .map(([doc, value]) =>
      `${doc}=${value === null || value === undefined ? "—" : String(value)}`,
    )
    .join(", ");
  return `Field "${issue.field}" needs your review (${values}). Which value is correct?`;
}

function readFileIds(task: Task): string[] {
  const input = task.input as { files?: unknown };
  if (
    !Array.isArray(input.files) ||
    input.files.some((file) => typeof file !== "string")
  ) {
    throw new ToolExecutionError(
      "Task input must contain a files string array",
      "invalid_tool",
    );
  }
  return input.files as string[];
}

function collectedDocuments(
  state: AgentState,
): Record<string, ExtractedDocument> {
  const out: Record<string, ExtractedDocument> = {};
  for (const observation of state.observations) {
    if (
      observation.intent.name === "extract_file" &&
      observation.status === "success" &&
      typeof observation.result === "object" &&
      observation.result !== null
    ) {
      const document = observation.result as ExtractedDocument;
      if (typeof document.id === "string") out[document.id] = document;
    }
  }
  return out;
}

export class FileConsistencyPolicyModel implements ModelPort {
  async decide(state: AgentState, signal: AbortSignal): Promise<Decision> {
    signal.throwIfAborted();
    const fileIds = readFileIds(state.task);
    const extracted = collectedDocuments(state);
    const remaining = fileIds.filter((id) => !extracted[id]);
    if (remaining.length > 0) {
      return {
        kind: "call_tool",
        intent: { name: "extract_file", arguments: { file: remaining[0] } },
      };
    }

    const compared = state.observations.find(
      (observation) =>
        observation.intent.name === "compare_fields" &&
        observation.status === "success",
    );
    if (!compared) {
      return {
        kind: "call_tool",
        intent: {
          name: "compare_fields",
          arguments: { documents: Object.values(extracted) },
        },
      };
    }

    const comparison = compared.result as DynamicComparison;
    const reviewIssues = comparison.issues.filter(
      (issue) => issue.needsHumanReview || issue.status === "must_fix",
    );
    const humanAnswers = state.messages.filter((m) => m.role === "human");

    if (humanAnswers.length < reviewIssues.length) {
      const issue = reviewIssues[humanAnswers.length];
      return { kind: "ask_human", question: buildQuestion(issue) };
    }

    const decisions = reviewIssues.map((issue, index) => ({
      field: issue.field,
      value: (humanAnswers[index] as { input: unknown }).input,
    }));
    const verdict: FileConsistencyVerdict = {
      outcome: "completed",
      comparison,
      decisions,
    };
    return { kind: "respond", content: verdict };
  }
}

export function fileConsistencyTask(id: string, files: string[]): Task {
  return { id, input: { files } };
}
