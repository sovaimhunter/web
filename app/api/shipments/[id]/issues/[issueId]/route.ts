import { NextResponse } from "next/server";
import { persistenceContext } from "@/lib/persistence/context";
import { persistenceErrorResponse } from "@/lib/persistence/http";
import type {
  IssueResolutionMethod,
  IssueWorkflowStatus,
} from "@/lib/persistence/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; issueId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id, issueId } = await context.params;
    const { repository, userId } = await persistenceContext(request);
    const body = (await request.json()) as {
      status?: unknown;
      note?: unknown;
      resolutionMethod?: unknown;
    };
    if (!["reviewed", "resolved"].includes(String(body.status))) {
      return NextResponse.json({ error: "Invalid issue status" }, { status: 400 });
    }
    const status = body.status as Extract<IssueWorkflowStatus, "reviewed" | "resolved">;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const resolutionMethod = body.resolutionMethod
      ? String(body.resolutionMethod)
      : undefined;
    if (status === "resolved") {
      if (resolutionMethod !== "accepted_exception") {
        return NextResponse.json(
          { error: "Issues are resolved by a re-check unless they are recorded as an accepted exception" },
          { status: 400 },
        );
      }
      if (note.length < 3) {
        return NextResponse.json(
          { error: "Add a short audit note before recording an expected difference" },
          { status: 400 },
        );
      }
    }
    const issue = await repository.updateIssue(
      issueId,
      id,
      status,
      {
        note: note || undefined,
        resolutionMethod: resolutionMethod as IssueResolutionMethod | undefined,
        reviewedBy: userId,
      },
    );
    return NextResponse.json(issue);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
