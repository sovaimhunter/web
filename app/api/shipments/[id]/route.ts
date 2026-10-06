import { NextResponse } from "next/server";
import { persistenceContext } from "@/lib/persistence/context";
import { notFound, persistenceErrorResponse } from "@/lib/persistence/http";
import type { UpdateShipmentInput } from "@/lib/persistence/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { repository } = await persistenceContext(request);
    const shipment = await repository.getShipment(id);
    return shipment ? NextResponse.json(shipment) : notFound("Shipment");
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { repository } = await persistenceContext(request);
    const body = (await request.json()) as UpdateShipmentInput;
    if (body.name !== undefined && body.name.trim() === "") {
      return NextResponse.json({ error: "Shipment name is required" }, { status: 400 });
    }
    return NextResponse.json(await repository.updateShipment(id, body));
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { repository } = await persistenceContext(request);
    await repository.deleteShipment(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
