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
  for (const [label, fileName] of documents) {
    const card = page.locator('[data-slot="card"]').filter({ hasText: label });
    await card.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: minimalPdf,
    });
  }
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
  await expect(page.getByText("All 3 PDFs ready")).toBeVisible();
  await page.getByRole("button", { name: "Check documents", exact: true }).click();
  await expect(page).toHaveURL(/\/shipments\/[^/]+\/results$/);
  const firstResultUrl = page.url();
  await expect(page.getByRole("heading", { name: "Consistency Check Results" })).toBeVisible();
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: /^\d+ Passed$/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passed checks" })).toBeVisible();

  await page.getByRole("link", { name: "Upload new documents" }).click();
  await uploadDocuments(page);
  await page.getByRole("button", { name: "Check documents", exact: true }).click();
  await expect(page).toHaveURL(firstResultUrl);
  await expect(page.getByRole("heading", { name: "Consistency Check Results" })).toBeVisible();

  await page.getByRole("link", { name: "Back to shipments" }).click();
  const shipmentRows = page.getByRole("row").filter({ hasText: "E2E repeat check" });
  await expect(shipmentRows).toHaveCount(1);
  await expect(shipmentRows.getByText("1 Must Fix", { exact: true })).toBeVisible();
});

test("check remains disabled while a whole document is missing", async ({ page }) => {
  await page.goto("/shipments/new");
  await page.getByRole("textbox", { name: "Shipment name" }).fill("Missing BOL");
  await page.getByRole("button", { name: "Continue to upload documents" }).click();

  for (const [label, fileName] of documents.slice(0, 2)) {
    const card = page.locator('[data-slot="card"]').filter({ hasText: label });
    await card.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: minimalPdf,
    });
  }

  await expect(page.getByText(/2\/3 PDFs ready/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check documents", exact: true }),
  ).toBeDisabled();
});
