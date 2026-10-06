import { NextResponse } from "next/server";
import type { AgentCheckResult, AgentFailedResult } from "@/lib/agent/result";
import { persistenceContext } from "@/lib/persistence/context";
import { notFound, persistenceErrorResponse } from "@/lib/persistence/http";
import { remapComparisonDocumentIds } from "@/lib/persistence/remap-comparison";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { repository } = await persistenceContext(request);
    const shipment = await repository.getShipment(id);
    return shipment
      ? NextResponse.json(shipment.checkHistory)
      : notFound("Shipment");
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { repository } = await persistenceContext(request);
    const shipment = await repository.getShipment(id);
    if (!shipment) return notFound("Shipment");
    const body = (await request.json()) as {
      result?: AgentCheckResult | AgentFailedResult;
      documentIds?: Record<string, string>;
    };
    if (!body.result || !body.documentIds) {
      return NextResponse.json(
        { error: "A check result and document mapping are required" },
        { status: 400 },
      );
    }
    const documentIds = body.documentIds;

    const run = await repository.createCheckRun(id);
    await repository.setShipmentStatus(id, "checking");
    if (body.result.outcome === "failed") {
      await repository.failCheck(run.id, id, body.result);
      return NextResponse.json({ runId: run.id, result: body.result }, { status: 201 });
    }

    const comparison = remapComparisonDocumentIds(
      body.result.comparison,
      documentIds,
    );
    const files = Object.fromEntries(
      Object.entries(body.result.files).map(([fileId, name]) => [
        documentIds[fileId] ?? fileId,
        name,
      ]),
    );
    const result: AgentCheckResult = {
      outcome: "completed",
      comparison,
      files,
    };
    const completed = await repository.completeCheck({
      checkRunId: run.id,
      shipmentId: id,
      documentIds: [...new Set(Object.values(documentIds))],
      result,
      comparison,
      events: [],
      status: "completed",
    });
    return NextResponse.json({ run: completed, result }, { status: 201 });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
