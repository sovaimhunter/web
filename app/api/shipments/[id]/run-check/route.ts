import { NextResponse } from "next/server";
import type { AgentCheckResult, AgentFailedResult } from "@/lib/agent/result";
import { loadDocumentConsistencyCatalog } from "@/lib/agent/catalog-file";
import { runFileConsistency, type PiDocument } from "@/lib/agent/pi/runtime";
import type { AgentEvent } from "@/lib/agent/types";
import { persistenceContext } from "@/lib/persistence/context";
import { notFound, persistenceErrorResponse } from "@/lib/persistence/http";
import type { CheckFailure } from "@/lib/types";

export const maxDuration = 120;
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function extractionFailure(message: string): CheckFailure {
  return {
    code: "EXTRACTION_FAILED",
    stage: "extraction",
    message,
    action: "Retry the check. If it continues, replace the affected PDF.",
    retryable: true,
  };
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const persistence = await persistenceContext(request);
    const shipment = await persistence.repository.getShipment(id);
    if (!shipment) return notFound("Shipment");
    if (shipment.documents.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one PDF before running a check." },
        { status: 400 },
      );
    }

    const run = await persistence.repository.createCheckRun(id);
    await persistence.repository.setShipmentStatus(id, "checking");

    const fileNames = Object.fromEntries(
      shipment.documents.map((document) => [document.id, document.originalName]),
    );
    const observedEvents: AgentEvent[] = [];

    try {
      const documents: PiDocument[] = [];
      for (const document of shipment.documents) {
        const { data, error } = await persistence.db.storage
          .from("shipment-documents")
          .download(document.storagePath);
        if (error || !data) {
          throw new Error(`Could not read ${document.originalName} from storage.`);
        }
        documents.push({
          id: document.id,
          file: new File([await data.arrayBuffer()], document.originalName, {
            type: document.mimeType || "application/pdf",
          }),
        });
      }

      const agentResult = await runFileConsistency({
        documents,
        catalog: loadDocumentConsistencyCatalog(),
        onEvent: (event) => observedEvents.push(event),
      });

      if (agentResult.status === "partial") {
        const result: AgentFailedResult = {
          outcome: "failed",
          files: fileNames,
          failures: [
            extractionFailure(
              `Could not extract every document: ${agentResult.missingMaterial
                .map((documentId) => fileNames[documentId] ?? documentId)
                .join(", ")}.`,
            ),
          ],
        };
        await persistence.repository.failCheck(
          run.id,
          id,
          result,
          agentResult.events,
        );
        return NextResponse.json({ runId: run.id, result }, { status: 201 });
      }

      const result: AgentCheckResult = {
        outcome: "completed",
        comparison: agentResult.comparison,
        files: fileNames,
      };
      const completed = await persistence.repository.completeCheck({
        checkRunId: run.id,
        shipmentId: id,
        documentIds: shipment.documents.map((document) => document.id),
        result,
        comparison: agentResult.comparison,
        events: agentResult.events,
        status: "completed",
      });
      return NextResponse.json({ run: completed, result }, { status: 201 });
    } catch (error) {
      const result: AgentFailedResult = {
        outcome: "failed",
        files: fileNames,
        failures: [
          extractionFailure(
            error instanceof Error
              ? error.message
              : "The document check could not be completed.",
          ),
        ],
      };
      await persistence.repository.failCheck(
        run.id,
        id,
        result,
        observedEvents,
      );
      return NextResponse.json({ runId: run.id, result }, { status: 201 });
    }
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
