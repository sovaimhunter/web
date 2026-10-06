import { describe, expect, it } from "vitest";
import { Core } from "../../lib/agent/core";
import { ScriptedModelPort } from "../../lib/agent/fake";
import type { AgentState, Decision } from "../../lib/agent/types";

function makeState(): AgentState {
  return {
    task: { id: "t1", input: {} },
    messages: [],
    observations: [],
    iteration: 0,
  };
}

describe("Agent Core", () => {
  it("delegates each decision to the model port in order", async () => {
    const script: Decision[] = [
      {
        kind: "call_tool",
        intent: { name: "extract_document", arguments: { document: "invoice" } },
      },
      { kind: "respond", content: { outcome: "completed" } },
    ];
    const core = new Core(new ScriptedModelPort(script));
    const signal = new AbortController().signal;

    const first = await core.step(makeState(), signal);
    const second = await core.step(makeState(), signal);

    expect(first).toEqual(script[0]);
    expect(second).toEqual(script[1]);
  });

  it("keeps no state of its own between steps", async () => {
    const decision: Decision = {
      kind: "call_tool",
      intent: { name: "extract_document", arguments: { document: "invoice" } },
    };
    const core = new Core(new ScriptedModelPort([decision, decision]));
    const signal = new AbortController().signal;

    await core.step(makeState(), signal);
    await expect(core.step(makeState(), signal)).resolves.toEqual(decision);
  });
});
