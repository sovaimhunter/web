import { NextResponse } from "next/server";
import { persistenceContext } from "@/lib/persistence/context";
import { deleteShipmentDocument } from "@/lib/persistence/document-service";
import { persistenceErrorResponse } from "@/lib/persistence/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; documentId: string }> };

export async function DELETE(request: Request, context: Context) {
  try {
    const { id, documentId } = await context.params;
    const persistence = await persistenceContext(request);
    await deleteShipmentDocument(persistence, id, documentId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return persistenceErrorResponse(error);
  }
}
