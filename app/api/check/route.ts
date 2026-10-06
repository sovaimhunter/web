import { NextResponse } from "next/server";
import type { DocumentConsistencyCatalog } from "@/lib/agent/catalog";
import { loadDocumentConsistencyCatalog } from "@/lib/agent/catalog-file";
import {
  compareExtractedDocuments,
  type DynamicComparison,
} from "@/lib/agent/compare-dynamic";
import type { ExtractedDocument } from "@/lib/agent/fields";
import {
  runFileConsistency,
  type PiDocument,
} from "@/lib/agent/pi/runtime";
import { MAX_UPLOAD_TOTAL_BYTES, type CheckFailure } from "@/lib/types";

export const maxDuration = 120;

export const runtime = "nodejs";

let catalogCache: DocumentConsistencyCatalog | undefined;

function loadCatalog(): DocumentConsistencyCatalog {
  if (!catalogCache) {
    catalogCache = loadDocumentConsistencyCatalog();
  }
  return catalogCache;
}

function failureResponse(failures: CheckFailure[], status: number) {
  return NextResponse.json(
    {
      error: failures[0]?.message ?? "The document check could not be completed.",
      failures,
    },
    { status },
  );
}

function uploadFailure(
  failure: Omit<CheckFailure, "stage">,
): CheckFailure {
  return { ...failure, stage: "upload" };
}

async function hasPdfStructure(file: File): Promise<boolean> {
  const header = Buffer.from(await file.slice(0, 1024).arrayBuffer());
  const trailer = Buffer.from(
    await file.slice(Math.max(0, file.size - 4096)).arrayBuffer(),
  );
  return header.indexOf("%PDF-") !== -1 && trailer.indexOf("%%EOF") !== -1;
}

function uniqueFileId(name: string, seen: Set<string>): string {
  if (!seen.has(name)) return name;
  let index = 2;
  while (seen.has(`${name}-${index}`)) index += 1;
  return `${name}-${index}`;
}

async function runMockComparison(
  catalog: DocumentConsistencyCatalog,
): Promise<DynamicComparison> {
  const { documents: mockDocuments } = await import("@/lib/mockData");
  const documents: ExtractedDocument[] = Object.entries(mockDocuments).map(
    ([id, fields]) => ({
      id,
      fields,
      extra: {},
      errors: [],
      provenance: { source: "mock", at: Date.now() },
    }),
  );
  return compareExtractedDocuments(documents, catalog);
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failureResponse(
      [
        uploadFailure({
          code: "INVALID_REQUEST",
          message: "The uploaded files could not be read.",
          action: "Choose the PDFs again and retry the check.",
          retryable: true,
        }),
      ],
      400,
    );
  }

  const rawFiles = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);
  if (rawFiles.length === 0) {
    return failureResponse(
      [
        uploadFailure({
          code: "MISSING_DOCUMENT",
          message: "No documents were uploaded.",
          action: "Add at least one PDF before running the check.",
          retryable: true,
        }),
      ],
      400,
    );
  }

  const files: Record<string, File> = {};
  const failures: CheckFailure[] = [];
  const seen = new Set<string>();
  for (const file of rawFiles) {
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      failures.push(
        uploadFailure({
          code: "INVALID_FILE_TYPE",
          message: `"${file.name}" must be a PDF file.`,
          action: "Replace it with a PDF and try again.",
          retryable: false,
        }),
      );
      continue;
    }
    if (file.size === 0) {
      failures.push(
        uploadFailure({
          code: "EMPTY_FILE",
          message: `"${file.name}" is empty.`,
          action: "Replace it with a non-empty PDF.",
          retryable: false,
        }),
      );
      continue;
    }
    if (!(await hasPdfStructure(file))) {
      failures.push(
        uploadFailure({
          code: "UNREADABLE_PDF",
          message: `"${file.name}" is not a valid PDF.`,
          action: "Replace it with a valid PDF exported from the source document.",
          retryable: false,
        }),
      );
      continue;
    }
    const id = uniqueFileId(file.name, seen);
    seen.add(id);
    files[id] = file;
  }

  if (failures.length > 0) {
    return failureResponse(failures, 400);
  }

  const totalBytes = Object.values(files).reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    return failureResponse(
      [
        uploadFailure({
          code: "UPLOAD_TOO_LARGE",
          message: "The PDFs together exceed the 4 MB upload limit.",
          action: "Compress the PDFs or replace them with smaller files.",
          retryable: false,
        }),
      ],
      413,
    );
  }

  const catalog = loadCatalog();
  const fileIds = Object.keys(files);

  let comparison: DynamicComparison;
  try {
    if (process.env.EXTRACTION_MODE === "mock") {
      comparison = await runMockComparison(catalog);
    } else {
      const documents: PiDocument[] = fileIds.map((id) => ({ id, file: files[id] }));
      const result = await runFileConsistency({ documents, catalog });
      if (result.status === "partial") {
        return failureResponse(
          [
            {
              code: "NO_FIELDS_EXTRACTED",
              stage: "extraction",
              message: `Could not extract every document: ${result.missingMaterial.join(", ")}.`,
              action: "Retry the check. If it continues, replace the affected PDFs.",
              retryable: true,
            },
          ],
          422,
        );
      }
      comparison = result.comparison;
    }
  } catch (error) {
    console.error("TradeLynk agent check failed:", error);
    return failureResponse(
      [
        {
          code: "CHECK_FAILED",
          stage: "comparison",
          message: "The document check could not be completed.",
          action: "Try the check again.",
          retryable: true,
        },
      ],
      500,
    );
  }

  const fileNames = Object.fromEntries(
    fileIds.map((id) => [id, files[id].name]),
  );
  return NextResponse.json({
    outcome: "completed",
    comparison,
    files: fileNames,
  });
}
