// Pure domain contracts for the in-memory Agent Core and Runtime.
//
// These types answer the Core question — "what does a valid agent run mean?" —
// and are deliberately free of any SDK, React, Next.js, or I/O dependency. The
// Runtime decides how a run actually executes; the Core only decides what is
// true about one.

export interface Task {
  id: string;
  /** Domain-specific material (for file consistency: the documents). */
  input: unknown;
}

export interface ToolIntent {
  name: string;
  arguments: Record<string, unknown>;
}

export type Decision =
  | { kind: "respond"; content: unknown }
  | { kind: "call_tool"; intent: ToolIntent }
  | { kind: "ask_human"; question: string };

export interface Observation {
  intent: ToolIntent;
  status: "success" | "error";
  result?: unknown;
  error?: { code: string; message: string };
}

export type AgentMessage =
  | { role: "assistant"; decision: Decision }
  | { role: "tool"; observation: Observation }
  | { role: "human"; input: unknown };

export interface AgentState {
  task: Task;
  /** Ordered transcript (assistant decisions, tool observations, human input). */
  messages: AgentMessage[];
  /** Projection of the tool observations for convenient access. */
  observations: Observation[];
  iteration: number;
}

export interface ModelPort {
  decide(state: AgentState, signal: AbortSignal): Promise<Decision>;
}

export interface ToolPort {
  execute(intent: ToolIntent, signal: AbortSignal): Promise<unknown>;
}

export interface AgentCore {
  step(state: AgentState, signal: AbortSignal): Promise<Decision>;
}

export type RunErrorCode =
  | "budget_iterations"
  | "budget_tools"
  | "budget_timeout"
  | "no_progress"
  | "rate_limited"
  | "timeout"
  | "auth"
  | "invalid_tool"
  | "provider_unavailable"
  | "runtime_error";

/** A tool failed in a way the agent can observe and react to. */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly code?: RunErrorCode,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

/** A tool name outside the explicit allowlist — a hard refusal, not a tool error. */
export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Tool "${name}" is not in the allowlist`);
    this.name = "UnknownToolError";
  }
}

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_human"
  | "completed"
  | "failed"
  | "cancelled";

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  toolCalls: number;
  durationMs: number;
  model?: string;
};

export type AgentEvent =
  | { type: "run_started"; runId: string; sequence: number; timestamp: number }
  | {
      type: "model_requested";
      runId: string;
      sequence: number;
      model?: string;
      timestamp: number;
    }
  | {
      type: "decision_made";
      runId: string;
      sequence: number;
      decision: Decision;
      timestamp: number;
    }
  | {
      type: "tool_started";
      runId: string;
      sequence: number;
      toolCallId: string;
      toolName: string;
      timestamp: number;
    }
  | {
      type: "tool_completed";
      runId: string;
      sequence: number;
      toolCallId: string;
      toolName: string;
      status: "success" | "error";
      result?: unknown;
      error?: { code: string; message: string };
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "observation_added";
      runId: string;
      sequence: number;
      name: string;
      observation: unknown;
      timestamp: number;
    }
  | {
      type: "human_input_requested";
      runId: string;
      sequence: number;
      question: string;
      timestamp: number;
    }
  | {
      type: "human_input_received";
      runId: string;
      sequence: number;
      input: unknown;
      timestamp: number;
    }
  | {
      type: "usage_reported";
      runId: string;
      sequence: number;
      usage: Usage;
      timestamp: number;
    }
  | {
      type: "run_completed";
      runId: string;
      sequence: number;
      status: "complete" | "partial";
      result: unknown;
      missingMaterial?: string[];
      timestamp: number;
    }
  | {
      type: "run_failed";
      runId: string;
      sequence: number;
      error: { code: RunErrorCode; message: string };
      timestamp: number;
    }
  | { type: "run_cancelled"; runId: string; sequence: number; timestamp: number }
  | { type: "run_resumed"; runId: string; sequence: number; timestamp: number };

export interface Run {
  runId: string;
  sessionId: string;
  task: Task;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  createdAt: number;
  runIds: string[];
}

export interface RunBudget {
  maxIterations: number;
  maxToolCalls: number;
  maxRetries: number;
  timeoutMs: number;
}

export interface SessionStore {
  createSession(): Promise<Session>;
  loadSession(id: string): Promise<Session | undefined>;
  saveSession(session: Session): Promise<void>;
}

export interface RunLog {
  appendEvent(event: AgentEvent): Promise<void>;
  listEvents(runId: string): Promise<AgentEvent[]>;
  loadRun(runId: string): Promise<Run | undefined>;
  saveRun(run: Run): Promise<void>;
}

export interface AgentRuntime {
  run(task: Task, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  /** Resume a run that is awaiting_human with the human's answer. */
  resume(
    runId: string,
    input: unknown,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent>;
}
