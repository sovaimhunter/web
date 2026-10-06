import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/check/route";
import type { CheckErrorResponse } from "../../lib/types";
import type { DynamicComparison } from "../../lib/agent/compare-dynamic";
import { minimalPdfFile } from "../helpers/fixtures";

const originalExtractionMode = process.env.EXTRACTION_MODE;
let consoleError: ReturnType<typeof vi.spyOn>;

type AgentCheckResult = {
  outcome: "completed";
  comparison: DynamicComparison;
  files: Record<string, string>;
};

function requestWithFiles(files: File[] = scenarioFilesArray()): Request {
  const body = new FormData();
  for (const file of files) body.append("files", file, file.name);
  return new Request("http://localhost/api/check", { method: "POST", body });
}

function scenarioFilesArray(): File[] {
  return [
    minimalPdfFile("01_commercial_invoice.pdf"),
    minimalPdfFile("02_packing_list.pdf"),
    minimalPdfFile("03_bill_of_lading.pdf"),
  ];
}

async function errorBody(response: Response): Promise<CheckErrorResponse> {
  return (await response.json()) as CheckErrorResponse;
}

beforeAll(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.EXTRACTION_MODE = "mock";
});

afterAll(() => {
  consoleError.mockRestore();
  if (originalExtractionMode === undefined) delete process.env.EXTRACTION_MODE;
  else process.env.EXTRACTION_MODE = originalExtractionMode;
});

describe("POST /api/check (dynamic agent)", () => {
  it("completes a check and returns a dynamic comparison", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const response = await POST(requestWithFiles());
    const body = (await response.json()) as AgentCheckResult;

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("completed");
    expect(body.comparison.documents).toHaveLength(3);
    expect(body.comparison.rows.length).toBeGreaterThan(0);
    expect(body.files["01_commercial_invoice.pdf"]).toBe("01_commercial_invoice.pdf");
  });

  it("reports when no files are uploaded", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const response = await POST(requestWithFiles([]));
    const body = await errorBody(response);

    expect(response.status).toBe(400);
    expect(body.failures[0]).toMatchObject({ code: "MISSING_DOCUMENT" });
  });

  it("rejects a non-PDF file", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const files = [new File(["hello"], "notes.txt", { type: "text/plain" })];
    const response = await POST(requestWithFiles(files));
    const body = await errorBody(response);

    expect(response.status).toBe(400);
    expect(body.failures[0]).toMatchObject({ code: "INVALID_FILE_TYPE" });
  });

  it("rejects a structurally corrupted PDF", async () => {
    process.env.EXTRACTION_MODE = "mock";
    const files = [
      new File(["%PDF-1.4\ncorrupted"], "corrupted.pdf", {
        type: "application/pdf",
      }),
    ];
    const response = await POST(requestWithFiles(files));
    const body = await errorBody(response);

    expect(response.status).toBe(400);
    expect(body.failures[0]).toMatchObject({ code: "UNREADABLE_PDF" });
  });
});
