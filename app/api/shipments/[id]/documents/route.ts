import { NextResponse } from "next/server";
import { persistenceContext } from "@/lib/persistence/context";
import { uploadShipmentDocument } from "@/lib/persistence/document-service";
import { persistenceErrorResponse } from "@/lib/persistence/http";
import type { DocumentType } from "@/lib/persistence/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const persistence = await persistenceContext(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
    }
    const documentType = form.get("documentType");
    const replaceDocumentId = form.get("replaceDocumentId");
    const document = await uploadShipmentDocument(persistence, {
      shipmentId: id,
      file,
      documentType:
        typeof documentType === "string" && documentType !== ""
          ? (documentType as DocumentType)
          : undefined,
      replaceDocumentId:
        typeof replaceDocumentId === "string" && replaceDocumentId !== ""
          ? replaceDocumentId
          : undefined,
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/required|Only PDF|empty|exceeds|invalid|not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return persistenceErrorResponse(error);
  }
}
