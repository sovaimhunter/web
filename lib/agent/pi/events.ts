import type { AgentEvent, ToolIntent } from "../types";

/**
 * Maps the Pi SDK's session events (structural subset, no SDK import) into the
 * product-level AgentEvent contract. Raw SDK events never leave the Runtime;
 * this mapper is the boundary.
 *
 * One SDK event can produce several product events (e.g. `tool_execution_end`
 * yields both `tool_completed` and `observation_added`). The returned bodies are
 * missing runId/sequence/timestamp — the runtime assigns those when persisting.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type AgentEventBody = DistributiveOmit<
  AgentEvent,
  "runId" | "sequence" | "timestamp"
>;

export type PiEvent =
  | { type: "agent_start" }
  | { type: "agent_settled" }
  | {
      type: "agent_end";
      messages?: Array<{ stopReason?: string; usage?: unknown }>;
      willRetry?: boolean;
    }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args?: unknown }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result?: unknown;
      isError?: boolean;
    };

function toArguments(args: unknown): Record<string, unknown> {
  if (typeof args === "object" && args !== null) {
    return args as Record<string, unknown>;
  }
  return {};
}

// The SDK wraps a tool's return value as AgentToolResult { content, details }.
// The domain result lives in `details`; unwrap it so product events carry the
// same shape whether they come from the fake path or the real SDK.
function unwrapResult(result: unknown): unknown {
  if (result && typeof result === "object" && "details" in result) {
    return (result as { details: unknown }).details;
  }
  return result;
}

export function mapPiEvent(event: PiEvent): AgentEventBody[] {
  switch (event.type) {
    case "agent_start":
      return [{ type: "run_started" }];

    case "tool_execution_start": {
      const intent: ToolIntent = {
        name: event.toolName,
        arguments: toArguments(event.args),
      };
      return [
        { type: "decision_made", decision: { kind: "call_tool", intent } },
        {
          type: "tool_started",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        },
      ];
    }

    case "tool_execution_end": {
      const result = unwrapResult(event.result);
      return [
        {
          type: "tool_completed",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? "error" : "success",
          result,
          error: event.isError
            ? { code: "runtime_error", message: String(event.result ?? "tool failed") }
            : undefined,
          durationMs: 0,
        },
        {
          type: "observation_added",
          name: event.toolName,
          observation: result,
        },
      ];
    }

    case "agent_end": {
      if (event.willRetry) return [];
      const last = event.messages?.[event.messages.length - 1];
      if (last?.stopReason === "aborted") {
        return [{ type: "run_cancelled" }];
      }
      if (last?.stopReason === "error" || last?.stopReason === "refusal") {
        return [
          {
            type: "run_failed",
            error: { code: "runtime_error", message: "Agent ended with an error" },
          },
        ];
      }
      return [{ type: "run_completed", status: "complete", result: undefined }];
    }

    case "agent_settled":
      // The true terminal anchor (after retry/compaction/queue). The terminal
      // run_* event is already derived from `agent_end`; nothing extra here.
      return [];

    default:
      return [];
  }
}
