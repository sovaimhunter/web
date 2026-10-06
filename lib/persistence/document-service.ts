import { createHash, randomUUID } from "node:crypto";
import { MAX_UPLOAD_TOTAL_BYTES } from "../types";
import type { PersistenceContext } from "./context";
import {
  inferDocumentType,
  type DocumentRecord,
  type DocumentType,
} from "./types";

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "document.pdf";
}

async function hasPdfStructure(file: File): Promise<boolean> {
  const header = Buffer.from(await file.slice(0, 1024).arrayBuffer());
  const trailer = Buffer.from(
    await file.slice(Math.max(0, file.size - 4096)).arrayBuffer(),
  );
  return header.indexOf("%PDF-") !== -1 && trailer.indexOf("%%EOF") !== -1;
}

export type UploadDocumentInput = {
  shipmentId: string;
  file: File;
  documentType?: DocumentType;
  replaceDocumentId?: string;
};

export async function uploadShipmentDocument(
  context: PersistenceContext,
  input: UploadDocumentInput,
): Promise<DocumentRecord> {
  const shipment = await context.repository.getShipment(input.shipmentId);
  if (!shipment) throw new Error("Shipment not found");
  if (
    input.file.type !== "application/pdf" &&
    !input.file.name.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Only PDF documents can be uploaded");
  }
  if (input.file.size === 0) throw new Error("The PDF is empty");
  if (input.file.size > MAX_UPLOAD_TOTAL_BYTES) {
    throw new Error("The PDF exceeds the 4 MB upload limit");
  }
  if (!(await hasPdfStructure(input.file))) throw new Error("The PDF is invalid");

  let replaced: DocumentRecord | null = null;
  if (input.replaceDocumentId) {
    replaced = await context.repository.getDocument(input.replaceDocumentId);
    if (!replaced || replaced.shipmentId !== input.shipmentId) {
      throw new Error("The document being replaced was not found");
    }
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${context.userId}/${input.shipmentId}/${randomUUID()}-${safeFilename(
    input.file.name,
  )}`;
  const storage = context.db.storage.from("shipment-documents");
  const { error: uploadError } = await storage.upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  try {
    const created = await context.repository.createDocument({
      shipmentId: input.shipmentId,
      documentType:
        input.documentType ??
        replaced?.documentType ??
        inferDocumentType(input.file.name),
      originalName: input.file.name,
      mimeType: "application/pdf",
      sizeBytes: input.file.size,
      storagePath,
      checksumSha256: checksum,
      version: (replaced?.version ?? 0) + 1,
      replacesDocumentId: replaced?.id,
    });
    if (replaced) await context.repository.supersedeDocument(replaced.id);
    await context.repository.setShipmentStatus(input.shipmentId, "draft");
    return created;
  } catch (error) {
    await storage.remove([storagePath]);
    throw error;
  }
}

export async function deleteShipmentDocument(
  context: PersistenceContext,
  shipmentId: string,
  documentId: string,
): Promise<void> {
  const document = await context.repository.getDocument(documentId);
  if (!document || document.shipmentId !== shipmentId) {
    throw new Error("Document not found");
  }
  await context.repository.deleteDocument(documentId);
  await context.repository.setShipmentStatus(shipmentId, "draft");
}
