import { NextResponse } from "next/server";
import { persistenceContext } from "@/lib/persistence/context";
import { persistenceErrorResponse } from "@/lib/persistence/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { repository } = await persistenceContext(request);
    return NextResponse.json(await repository.listShipments());
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { repository } = await persistenceContext(request);
    const body = (await request.json()) as { name?: unknown; reference?: unknown };
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json({ error: "Shipment name is required" }, { status: 400 });
    }
    const shipment = await repository.createShipment({
      name: body.name,
      reference: typeof body.reference === "string" ? body.reference : "",
    });
    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
