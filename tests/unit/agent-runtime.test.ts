import { describe, expect, it } from "vitest";
import { Core } from "../../lib/agent/core";
import { ScriptedModelPort } from "../../lib/agent/fake";
import {
  InMemoryAgentRuntime,
  InMemoryRunLog,
  InMemorySessionStore,
  replayAgentState,
  ToolRegistry,
} from "../../lib/agent/runtime";
import { ToolExecutionError } from "../../lib/agent/types";
import type {
  AgentEvent,
  Decision,
  ModelPort,
  RunBudget,
  Task,
  ToolIntent,
  ToolPort,
} from "../../lib/agent/types";

const DEFAULT_BUDGET: RunBudget = {
  maxIterations: 10,
  maxToolCalls: 10,
  maxRetries: 0,
  timeoutMs: 5000,
};

function tool(name: string, fn: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>): [string, ToolPort] {
  return [name, { execute: (intent: ToolIntent, signal: AbortSignal) => fn(intent.arguments, signal) }];
}

function runtimeFor(
  model: ModelPort,
  tools: [string, ToolPort][] = [],
  overrides: Partial<RunBudget> = {},
): InMemoryAgentRuntime {
  return new InMemoryAgentRuntime({
    core: new Core(model),
    tools: new ToolRegistry(new Map(tools)),
    sessions: new InMemorySessionStore(),
    runLog: new InMemoryRunLog(),
    budget: { ...DEFAULT_BUDGET, ...overrides },
    model: "fake",
  });
}

async function collect(
  runtime: InMemoryAgentRuntime,
  task: Task,
  signal?: AbortSignal,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(task, signal)) events.push(event);
  return events;
}

async function collectResume(
  runtime: InMemoryAgentRuntime,
  runId: string,
  input: unknown,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runtime.resume(runId, input)) events.push(event);
  return events;
}

function byType<T extends AgentEvent["type"]>(
  events: AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<AgentEvent, { type: T }>[];
}

const TASK: Task = { id: "t1", input: {} };

describe("In-memory Agent Runtime", () => {
  it("runs the full decision → tool → observation → respond loop in order", async () => {
    const model = new ScriptedModelPort([
      { kind: "call_tool", intent: { name: "add", arguments: { a: 2, b: 3 } } },
      { kind: "respond", content: { outcome: "completed", total: 5 } },
    ]);
    const runtime = runtimeFor(model, [
      tool("add", async (args) => (args.a as number) + (args.b as number)),
    ]);

    const events = await collect(runtime, TASK);

    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "model_requested",
      "decision_made",
      "tool_started",
      "tool_completed",
      "observation_added",
      "model_requested",
      "decision_made",
      "run_completed",
      "usage_reported",
    ]);

    const toolCompleted = byType(events, "tool_completed")[0];
    expect(toolCompleted.status).toBe("success");
    expect(toolCompleted.result).toBe(5);

    const completed = byType(events, "run_completed")[0];
    expect(completed.status).toBe("complete");
    expect(completed.result).toEqual({ outcome: "completed", total: 5 });

    const usage = byType(events, "usage_reported")[0];
    expect(usage.usage.toolCalls).toBe(1);
    expect(usage.usage.model).toBe("fake");
  });

  it("surfaces a tool failure as an observation without corrupting the run", async () => {
    const model = new ScriptedModelPort([
      { kind: "call_tool", intent: { name: "boom", arguments: {} } },
      { kind: "call_tool", intent: { name: "add", arguments: { a: 1, b: 1 } } },
      { kind: "respond", content: { outcome: "completed" } },
    ]);
    const runtime = runtimeFor(model, [
      tool("boom", async () => {
        throw new ToolExecutionError("boom failed", "runtime_error");
      }),
      tool("add", async (args) => (args.a as number) + (args.b as number)),
    ]);

    const events = await collect(runtime, TASK);

    const toolCompleted = byType(events, "tool_completed");
    expect(toolCompleted[0]).toMatchObject({ toolName: "boom", status: "error" });
    expect(toolCompleted[0].error?.code).toBe("runtime_error");
    expect(toolCompleted[1]).toMatchObject({ toolName: "add", status: "success" });

    expect(byType(events, "run_completed")).toHaveLength(1);
    expect(byType(events, "usage_reported")[0].usage.toolCalls).toBe(2);
  });

  it("refuses an unknown tool and fails the run with invalid_tool", async () => {
    const model = new ScriptedModelPort([
      { kind: "call_tool", intent: { name: "not_allowed", arguments: {} } },
    ]);
    const runtime = runtimeFor(model);

    const events = await collect(runtime, TASK);

    expect(byType(events, "run_failed")[0].error.code).toBe("invalid_tool");
    expect(byType(events, "tool_started")).toHaveLength(0);
  });

  it("terminates with budget_iterations when the model never settles", async () => {
    const script: Decision[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "call_tool",
      intent: { name: "add", arguments: { a: i, b: 0 } },
    }));
    const model = new ScriptedModelPort(script);
    const runtime = runtimeFor(
      model,
      [tool("add", async (args) => (args.a as number) + (args.b as number))],
      { maxIterations: 2, maxToolCalls: 100 },
    );

    const events = await collect(runtime, TASK);

    expect(byType(events, "run_failed")[0].error.code).toBe("budget_iterations");
  });

  it("terminates with budget_tools when the tool budget is spent", async () => {
    const script: Decision[] = [
      { kind: "call_tool", intent: { name: "add", arguments: { a: 1, b: 1 } } },
      { kind: "call_tool", intent: { name: "add", arguments: { a: 2, b: 2 } } },
      { kind: "respond", content: { outcome: "completed" } },
    ];
    const model = new ScriptedModelPort(script);
    const runtime = runtimeFor(
      model,
      [tool("add", async (args) => (args.a as number) + (args.b as number))],
      { maxToolCalls: 1 },
    );

    const events = await collect(runtime, TASK);

    expect(byType(events, "run_failed")[0].error.code).toBe("budget_tools");
  });

  it("honours caller cancellation and emits run_cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = runtimeFor(new ScriptedModelPort([]));

    const events = await collect(runtime, TASK, controller.signal);

    expect(byType(events, "run_cancelled")).toHaveLength(1);
    expect(byType(events, "run_failed")).toHaveLength(0);
  });

  it("fails with budget_timeout when the model blocks past the budget", async () => {
    const blockingModel: ModelPort = {
      decide: (_state, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        }),
    };
    const runtime = runtimeFor(blockingModel, [], { timeoutMs: 20 });

    const events = await collect(runtime, TASK);

    expect(byType(events, "run_failed")[0].error.code).toBe("budget_timeout");
  });

  it("isolates sessions and their event logs", async () => {
    const runLog = new InMemoryRunLog();
    const sessions = new InMemorySessionStore();
    const makeRuntime = () =>
      new InMemoryAgentRuntime({
        core: new Core(
          new ScriptedModelPort([
            { kind: "respond", content: { outcome: "completed" } },
          ]),
        ),
        tools: new ToolRegistry(new Map()),
        sessions,
        runLog,
        budget: DEFAULT_BUDGET,
      });

    const first = await collect(makeRuntime(), { id: "a", input: {} });
    const second = await collect(makeRuntime(), { id: "b", input: {} });

    const firstRunId = byType(first, "run_started")[0].runId;
    const secondRunId = byType(second, "run_started")[0].runId;
    expect(firstRunId).not.toBe(secondRunId);

    const firstLog = await runLog.listEvents(firstRunId);
    const secondLog = await runLog.listEvents(secondRunId);
    expect(firstLog.map((e) => e.runId)).toEqual(Array(firstLog.length).fill(firstRunId));
    expect(secondLog.map((e) => e.runId)).toEqual(Array(secondLog.length).fill(secondRunId));
  });

  it("reconstructs AgentState from the event log", async () => {
    const model = new ScriptedModelPort([
      { kind: "call_tool", intent: { name: "add", arguments: { a: 2, b: 3 } } },
      { kind: "respond", content: { outcome: "completed" } },
    ]);
    const runLog = new InMemoryRunLog();
    const runtime = new InMemoryAgentRuntime({
      core: new Core(model),
      tools: new ToolRegistry(
        new Map([tool("add", async (args) => (args.a as number) + (args.b as number))]),
      ),
      sessions: new InMemorySessionStore(),
      runLog,
      budget: DEFAULT_BUDGET,
    });

    const events = await collect(runtime, TASK);
    const runId = byType(events, "run_started")[0].runId;
    const replayed = replayAgentState(TASK, await runLog.listEvents(runId));

    expect(replayed.iteration).toBe(2);
    expect(replayed.observations).toHaveLength(1);
    expect(replayed.observations[0].intent.name).toBe("add");
    expect(replayed.messages.map((m) => m.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("pauses on ask_human and resumes with the human's answer", async () => {
    const model: ModelPort = {
      decide: async (state) => {
        const human = state.messages.find((m) => m.role === "human");
        if (!human) {
          return { kind: "ask_human", question: "Which exporter is correct?" };
        }
        return {
          kind: "respond",
          content: { outcome: "completed", answer: human.input },
        };
      },
    };
    const runLog = new InMemoryRunLog();
    const runtime = new InMemoryAgentRuntime({
      core: new Core(model),
      tools: new ToolRegistry(new Map()),
      sessions: new InMemorySessionStore(),
      runLog,
      budget: DEFAULT_BUDGET,
    });

    const first = await collect(runtime, TASK);
    expect(byType(first, "human_input_requested")[0].question).toBe(
      "Which exporter is correct?",
    );
    expect(byType(first, "run_completed")).toHaveLength(0);

    const runId = byType(first, "run_started")[0].runId;
    const second = await collectResume(runtime, runId, "Acme Pty Ltd");

    expect(byType(second, "human_input_received")).toHaveLength(1);
    expect(byType(second, "run_resumed")).toHaveLength(1);
    expect(byType(second, "run_completed")[0].result).toEqual({
      outcome: "completed",
      answer: "Acme Pty Ltd",
    });

    // The full event log replays to a state that includes the human input.
    const replayed = replayAgentState(TASK, await runLog.listEvents(runId));
    expect(replayed.messages.some((m) => m.role === "human")).toBe(true);
  });
});
