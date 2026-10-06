import type { ToolIntent, ToolPort } from "../types";

/**
 * Adapts a domain ToolPort into the shape the Pi SDK's ToolDefinition.execute
 * expects: params in, AgentToolResult-shaped value out, throw on failure.
 *
 * The TypeBox `parameters` schema (the model-facing signature) is added at
 * registration time in Step 5; this module only covers the execute boundary,
 * which is what can be unit-tested without a live session.
 */

export type AgentToolResultLike = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
};

export type AdaptedToolExecute = (
  toolCallId: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
) => Promise<AgentToolResultLike>;

export function adaptTool(name: string, port: ToolPort): AdaptedToolExecute {
  return async (_toolCallId, params, signal) => {
    const intent: ToolIntent = { name, arguments: params ?? {} };
    const result = await port.execute(
      intent,
      signal ?? new AbortController().signal,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: result,
    };
  };
}
