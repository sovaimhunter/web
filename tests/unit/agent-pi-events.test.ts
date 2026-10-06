import { describe, expect, it } from "vitest";
import { mapPiEvent } from "../../lib/agent/pi/events";

describe("mapPiEvent", () => {
  it("maps agent_start to run_started", () => {
    expect(mapPiEvent({ type: "agent_start" })).toEqual([
      { type: "run_started" },
    ]);
  });

  it("maps tool_execution_start to decision_made + tool_started", () => {
    const result = mapPiEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "extract_file",
      args: { document: "invoice" },
    });

    expect(result).toEqual([
      {
        type: "decision_made",
        decision: {
          kind: "call_tool",
          intent: { name: "extract_file", arguments: { document: "invoice" } },
        },
      },
      { type: "tool_started", toolCallId: "call-1", toolName: "extract_file" },
    ]);
  });

  it("maps a successful tool_execution_end to tool_completed + observation_added", () => {
    const result = mapPiEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "compare_fields",
      result: { issues: [] },
      isError: false,
    });

    expect(result).toEqual([
      {
        type: "tool_completed",
        toolCallId: "call-1",
        toolName: "compare_fields",
        status: "success",
        result: { issues: [] },
        error: undefined,
        durationMs: 0,
      },
      {
        type: "observation_added",
        name: "compare_fields",
        observation: { issues: [] },
      },
    ]);
  });

  it("maps a failed tool_execution_end to an error tool_completed", () => {
    const result = mapPiEvent({
      type: "tool_execution_end",
      toolCallId: "call-2",
      toolName: "extract_file",
      result: "boom",
      isError: true,
    });

    expect(result[0]).toMatchObject({ status: "error" });
    expect(result[0]).toHaveProperty("error.code", "runtime_error");
  });

  it("does not treat agent_end with willRetry as terminal", () => {
    expect(
      mapPiEvent({ type: "agent_end", messages: [], willRetry: true }),
    ).toEqual([]);
  });

  it("maps agent_end stopReason=aborted to run_cancelled", () => {
    expect(
      mapPiEvent({
        type: "agent_end",
        messages: [{ stopReason: "aborted" }],
        willRetry: false,
      }),
    ).toEqual([{ type: "run_cancelled" }]);
  });

  it("maps agent_end stopReason=error to run_failed", () => {
    const result = mapPiEvent({
      type: "agent_end",
      messages: [{ stopReason: "error" }],
      willRetry: false,
    });

    expect(result).toEqual([
      {
        type: "run_failed",
        error: { code: "runtime_error", message: "Agent ended with an error" },
      },
    ]);
  });

  it("maps a normal agent_end to run_completed", () => {
    expect(
      mapPiEvent({
        type: "agent_end",
        messages: [{ stopReason: "end_turn" }],
        willRetry: false,
      }),
    ).toEqual([{ type: "run_completed", status: "complete", result: undefined }]);
  });

  it("maps agent_settled to no product events", () => {
    expect(mapPiEvent({ type: "agent_settled" })).toEqual([]);
  });

  it("unwraps AgentToolResult details into the observation", () => {
    const result = mapPiEvent({
      type: "tool_execution_end",
      toolCallId: "call-3",
      toolName: "extract_file",
      result: {
        content: [{ type: "text", text: "ok" }],
        details: { id: "invoice", fields: { exporter: "Acme" } },
      },
      isError: false,
    });

    expect(result[0]).toMatchObject({
      type: "tool_completed",
      result: { id: "invoice", fields: { exporter: "Acme" } },
    });
    expect(result[1]).toEqual({
      type: "observation_added",
      name: "extract_file",
      observation: { id: "invoice", fields: { exporter: "Acme" } },
    });
  });
});
