import { expect, test, type Page } from "@playwright/test";

const minimalPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
);

const documents = [
  ["Commercial Invoice", "01_commercial_invoice.pdf"],
  ["Packing List", "02_packing_list.pdf"],
  ["Bill of Lading", "03_bill_of_lading.pdf"],
] as const;

async function uploadDocuments(page: Page) {
  await page.locator('input[type="file"][multiple]').setInputFiles(
    documents.map(([, fileName]) => ({
      name: fileName,
      mimeType: "application/pdf",
      buffer: minimalPdf,
    })),
  );
}

test("new exporter completes the workflow and re-checks the same shipment", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "New shipment", exact: true }).click();
  await page.getByRole("textbox", { name: "Shipment name" }).fill("E2E repeat check");
  await page.getByRole("textbox", { name: "Reference" }).fill("E2E-001");
  await page.getByRole("button", { name: "Continue to upload documents" }).click();

  await uploadDocuments(page);
  await expect(page.getByText("3 active documents")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Run check", exact: true }).click();
  await expect(page).toHaveURL(/\/shipments\/[^/]+\/results$/, {
    timeout: 30_000,
  });
  const firstResultUrl = page.url();
  await expect(page.getByRole("heading", { name: "Document review" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Latest check summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Issue workbench" })).toBeVisible();

  await page.getByRole("button", { name: "Run check again" }).click();
  await expect(page).toHaveURL(firstResultUrl, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Document review" })).toBeVisible();
  await expect(page.getByText("Latest check #2")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Back to shipments" }).click();
  const shipmentRows = page.getByRole("row").filter({ hasText: "E2E repeat check" });
  await expect(shipmentRows).toHaveCount(1);
  await expect(shipmentRows.getByText(/\d+ issues?/)).toBeVisible();
});

test("check can run with a partial export-document set", async ({ page }) => {
  await page.goto("/shipments/new");
  await page.getByRole("textbox", { name: "Shipment name" }).fill("Missing BOL");
  await page.getByRole("button", { name: "Continue to upload documents" }).click();

  await page.locator('input[type="file"][multiple]').setInputFiles(
    documents.slice(0, 2).map(([, fileName]) => ({
      name: fileName,
      mimeType: "application/pdf",
      buffer: minimalPdf,
    })),
  );

  await expect(page.getByText("2 active documents")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Run check", exact: true }),
  ).toBeEnabled();
});
