import { NextResponse } from "next/server";
import { compareDocuments } from "@/lib/compare";
import { ExtractionBatchError, extractAll } from "@/lib/extract";
import {
  DOC_KEYS,
  DOC_NAMES,
  MAX_UPLOAD_TOTAL_BYTES,
  type CheckFailure,
  type DocKey,
} from "@/lib/types";

export const maxDuration = 120;

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
          action: "Choose the three PDFs again and retry the check.",
          retryable: true,
        }),
      ],
      400,
    );
  }

  const files: Partial<Record<DocKey, File>> = {};
  const validationFailures: CheckFailure[] = [];

  for (const key of DOC_KEYS) {
    const value = formData.get(key);
    if (!(value instanceof File)) {
      validationFailures.push(
        uploadFailure({
          code: "MISSING_DOCUMENT",
          document: key,
          message: `${DOC_NAMES[key]} is missing.`,
          action: `Add the ${DOC_NAMES[key]} before running the check.`,
          retryable: true,
        }),
      );
      continue;
    }
    const isPdf =
      value.type === "application/pdf" ||
      value.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      validationFailures.push(
        uploadFailure({
          code: "INVALID_FILE_TYPE",
          document: key,
          message: `${DOC_NAMES[key]} must be a PDF file.`,
          action: "Replace it with a PDF and try again.",
          retryable: false,
        }),
      );
      continue;
    }
    if (value.size === 0) {
      validationFailures.push(
        uploadFailure({
          code: "EMPTY_FILE",
          document: key,
          message: `${DOC_NAMES[key]} is empty.`,
          action: "Replace it with a non-empty PDF.",
          retryable: false,
        }),
      );
      continue;
    }
    if (!(await hasPdfStructure(value))) {
      validationFailures.push(
        uploadFailure({
          code: "UNREADABLE_PDF",
          document: key,
          message: `${DOC_NAMES[key]} is not a valid PDF.`,
          action: "Replace it with a valid PDF exported from the source document.",
          retryable: false,
        }),
      );
      continue;
    }
    files[key] = value;
  }

  if (validationFailures.length > 0) {
    return failureResponse(validationFailures, 400);
  }

  // Backstop for local dev — on Vercel a body this large is rejected with a
  // 413 before this handler is ever invoked.
  const totalBytes = DOC_KEYS.reduce((sum, key) => sum + files[key]!.size, 0);
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    return failureResponse(
      [
        uploadFailure({
          code: "UPLOAD_TOO_LARGE",
          message: "The three PDFs together exceed the 4 MB upload limit.",
          action: "Compress the PDFs or replace them with smaller files.",
          retryable: false,
        }),
      ],
      413,
    );
  }

  let documents;
  try {
    documents = await extractAll(files as Record<DocKey, File>);
  } catch (error) {
    console.error("TradeLynk extraction failed:", error);
    if (error instanceof ExtractionBatchError) {
      const status = error.failures.some(
        (failure) =>
          failure.code === "PROVIDER_TIMEOUT" ||
          failure.code === "PROVIDER_UNAVAILABLE",
      )
        ? 503
        : 422;
      return failureResponse(error.failures, status);
    }
    return failureResponse(
      [
        {
          code: "EXTRACTION_FAILED",
          stage: "extraction",
          message: "The documents could not be extracted.",
          action: "Try again. If the problem continues, replace the PDFs.",
          retryable: true,
        },
      ],
      500,
    );
  }

  try {
    if (
      process.env.NODE_ENV === "test" &&
      process.env.CHECK_TEST_FAILURE === "comparison"
    ) {
      throw new Error("Simulated comparison failure");
    }
    const fileNames = Object.fromEntries(
      DOC_KEYS.map((key) => [key, files[key]!.name]),
    ) as Record<DocKey, string>;
    return NextResponse.json({
      outcome: "completed",
      ...compareDocuments(documents),
      files: fileNames,
    });
  } catch (error) {
    console.error("TradeLynk comparison failed:", error);
    return failureResponse(
      [
        {
          code: "CHECK_FAILED",
          stage: "comparison",
          message: "The extracted document details could not be compared.",
          action: "Try the check again.",
          retryable: true,
        },
      ],
      500,
    );
  }
}
