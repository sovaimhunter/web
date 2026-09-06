import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/check/route";
import type { CheckErrorResponse, CheckResult, DocKey } from "../../lib/types";
import { minimalPdfFile, scenarioFiles } from "../helpers/fixtures";

const originalExtractionMode = process.env.EXTRACTION_MODE;
const originalCheckFailure = process.env.CHECK_TEST_FAILURE;
let consoleError: ReturnType<typeof vi.spyOn>;

function requestWithFiles(
  files: Partial<Record<DocKey, File>> = scenarioFiles(),
): Request {
  const body = new FormData();
  for (const [key, file] of Object.entries(files)) {
    if (file) body.append(key, file);
  }
  return new Request("http://localhost/api/check", { method: "POST", body });
}

async function errorBody(response: Response): Promise<CheckErrorResponse> {
  return (await response.json()) as CheckErrorResponse;
}

beforeAll(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.EXTRACTION_MODE = "mock";
  delete process.env.CHECK_TEST_FAILURE;
});

afterAll(() => {
  consoleError.mockRestore();
  if (originalExtractionMode === undefined) delete process.env.EXTRACTION_MODE;
  else process.env.EXTRACTION_MODE = originalExtractionMode;
  if (originalCheckFailure === undefined) delete process.env.CHECK_TEST_FAILURE;
  else process.env.CHECK_TEST_FAILURE = originalCheckFailure;
});

describe("POST /api/check", () => {
  it("completes a normal three-document check", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const response = await POST(requestWithFiles());
    const body = (await response.json()) as CheckResult;
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("completed");
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it("reports a missing whole document", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const files = scenarioFiles();
    delete (files as Partial<Record<DocKey, File>>).bill_of_lading;
    const response = await POST(requestWithFiles(files));
    const body = await errorBody(response);
    expect(response.status).toBe(400);
    expect(body.failures).toContainEqual(
      expect.objectContaining({
        code: "MISSING_DOCUMENT",
        document: "bill_of_lading",
      }),
    );
  });

  it("rejects a structurally corrupted PDF", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const files = scenarioFiles();
    files.invoice = new File(["%PDF-1.4\ncorrupted"], "corrupted.pdf", {
      type: "application/pdf",
    });
    const response = await POST(requestWithFiles(files));
    const body = await errorBody(response);
    expect(response.status).toBe(400);
    expect(body.failures[0]).toMatchObject({
      code: "UNREADABLE_PDF",
      document: "invoice",
    });
  });

  it("reports a scan with no extractable text", async () => {
    process.env.EXTRACTION_MODE = "mock_no_fields";
    const files = scenarioFiles();
    files.invoice = minimalPdfFile("scanned-no-text.pdf");
    const response = await POST(requestWithFiles(files));
    const body = await errorBody(response);
    expect(response.status).toBe(422);
    expect(body.failures[0]).toMatchObject({
      code: "NO_FIELDS_EXTRACTED",
      document: "invoice",
      stage: "extraction",
    });
  });

  it("reports a total extraction failure", async () => {
    process.env.EXTRACTION_MODE = "mock_extraction_failure";
    const response = await POST(requestWithFiles());
    const body = await errorBody(response);
    expect(response.status).toBe(422);
    expect(body.failures).toHaveLength(3);
    expect(body.failures.every((failure) => failure.code === "EXTRACTION_FAILED")).toBe(true);
  });

  it("identifies the single document in a partial extraction failure", async () => {
    process.env.EXTRACTION_MODE = "mock_partial_failure";
    const response = await POST(requestWithFiles());
    const body = await errorBody(response);
    expect(response.status).toBe(422);
    expect(body.failures).toEqual([
      expect.objectContaining({
        code: "EXTRACTION_FAILED",
        document: "packing_list",
      }),
    ]);
  });

  it("returns a retryable service response for API timeouts", async () => {
    process.env.EXTRACTION_MODE = "mock_timeout";
    const response = await POST(requestWithFiles());
    const body = await errorBody(response);
    expect(response.status).toBe(503);
    expect(body.failures).toHaveLength(3);
    expect(body.failures.every((failure) => failure.code === "PROVIDER_TIMEOUT")).toBe(true);
    expect(body.failures.every((failure) => failure.retryable)).toBe(true);
  });

  it("normalizes provider server errors", async () => {
    process.env.EXTRACTION_MODE = "mock_provider_error";
    const response = await POST(requestWithFiles());
    const body = await errorBody(response);
    expect(response.status).toBe(503);
    expect(body.failures).toEqual([
      expect.objectContaining({
        code: "PROVIDER_UNAVAILABLE",
        stage: "extraction",
      }),
    ]);
  });

  it("returns a structured comparison server error", async () => {
    process.env.EXTRACTION_MODE = "mock";
    process.env.CHECK_TEST_FAILURE = "comparison";
    const response = await POST(requestWithFiles());
    const body = await errorBody(response);
    expect(response.status).toBe(500);
    expect(body.failures).toEqual([
      expect.objectContaining({
        code: "CHECK_FAILED",
        stage: "comparison",
        retryable: true,
      }),
    ]);
  });
});
