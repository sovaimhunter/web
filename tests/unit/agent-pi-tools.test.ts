import { describe, expect, it } from "vitest";
import { adaptTool } from "../../lib/agent/pi/tools";
import type { ToolPort } from "../../lib/agent/types";

describe("adaptTool", () => {
  it("wraps a ToolPort result into an AgentToolResult shape", async () => {
    const port: ToolPort = {
      execute: async (intent) => ({
        document: intent.arguments.document,
        fields: { exporter: "Acme Pty Ltd" },
      }),
    };

    const execute = adaptTool("extract_file", port);
    const result = await execute("call-1", { document: "invoice" }, undefined);

    expect(result.details).toEqual({
      document: "invoice",
      fields: { exporter: "Acme Pty Ltd" },
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          document: "invoice",
          fields: { exporter: "Acme Pty Ltd" },
        }),
      },
    ]);
  });

  it("propagates tool failures by throwing", async () => {
    const port: ToolPort = {
      execute: async () => {
        throw new Error("extraction failed");
      },
    };

    const execute = adaptTool("extract_file", port);
    await expect(
      execute("call-1", { document: "invoice" }, undefined),
    ).rejects.toThrow("extraction failed");
  });
});
