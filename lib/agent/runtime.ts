import { randomUUID } from "node:crypto";
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from "node:timers";
import type {
  AgentCore,
  AgentEvent,
  AgentRuntime,
  AgentState,
  Observation,
  Run,
  RunBudget,
  RunErrorCode,
  RunLog,
  RunStatus,
  Session,
  SessionStore,
  Task,
  ToolIntent,
  ToolPort,
  Usage,
} from "./types";
import { ToolExecutionError, UnknownToolError } from "./types";

// `Omit` does not distribute over unions, so `keyof AgentEvent` collapses to
// the common keys. A distributive omit preserves each event variant.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type EventInput = DistributiveOmit<
  AgentEvent,
  "runId" | "sequence" | "timestamp"
>;

const RETRYABLE_CODES: ReadonlySet<RunErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "provider_unavailable",
]);

function isRetryable(code: RunErrorCode | undefined): boolean {
  return code !== undefined && RETRYABLE_CODES.has(code);
}

function errorCode(error: unknown): RunErrorCode {
  if (error instanceof ToolExecutionError && error.code) return error.code;
  if (error instanceof UnknownToolError) return "invalid_tool";
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "runtime_error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** In-memory SessionStore. One entry per session, isolated by id. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  async createSession(): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      createdAt: Date.now(),
      runIds: [],
    };
    this.sessions.set(session.id, structuredClone(session));
    return structuredClone(session);
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }
}

/** In-memory append-only RunLog. Events are the source of truth for a run. */
export class InMemoryRunLog implements RunLog {
  private readonly events = new Map<string, AgentEvent[]>();
  private readonly runs = new Map<string, Run>();

  async appendEvent(event: AgentEvent): Promise<void> {
    const list = this.events.get(event.runId) ?? [];
    list.push(structuredClone(event));
    this.events.set(event.runId, list);
  }

  async listEvents(runId: string): Promise<AgentEvent[]> {
    return structuredClone(this.events.get(runId) ?? []);
  }

  async loadRun(runId: string): Promise<Run | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async saveRun(run: Run): Promise<void> {
    this.runs.set(run.runId, structuredClone(run));
  }
}

/**
 * Tool executor with an explicit allowlist. Unknown tool names are refused
 * before any handler runs.
 */
export class ToolRegistry {
  constructor(private readonly tools: ReadonlyMap<string, ToolPort>) {}

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async execute(intent: ToolIntent, signal: AbortSignal): Promise<unknown> {
    const tool = this.tools.get(intent.name);
    if (!tool) throw new UnknownToolError(intent.name);
    return tool.execute(intent, signal);
  }
}

export interface RuntimeOptions {
  core: AgentCore;
  tools: ToolRegistry;
  sessions: SessionStore;
  runLog: RunLog;
  budget: RunBudget;
  model?: string;
}

class RunBudgetError extends Error {
  constructor(
    public readonly code: "budget_iterations" | "budget_tools",
    message: string,
  ) {
    super(message);
    this.name = "RunBudgetError";
  }
}

/** Mutable per-run state shared across a run's segments (fresh + resume). */
type DriveContext = {
  run: Run;
  state: AgentState;
  sequence: number;
  toolCalls: number;
  startedAt: number;
};

/**
 * In-memory Runtime. Owns session/run identity, ordered event emission, tool
 * execution with bounded retries, budgets, cancellation, and the no-progress
 * guard. It yields product-level events; raw adapters never leak through.
 */
export class InMemoryAgentRuntime implements AgentRuntime {
  private readonly core: AgentCore;
  private readonly tools: ToolRegistry;
  private readonly sessions: SessionStore;
  private readonly runLog: RunLog;
  private readonly budget: RunBudget;
  private readonly model?: string;

  constructor(options: RuntimeOptions) {
    this.core = options.core;
    this.tools = options.tools;
    this.sessions = options.sessions;
    this.runLog = options.runLog;
    this.budget = options.budget;
    this.model = options.model;
  }

  /**
   * Executes one tool with bounded retries for retryable provider errors.
   * Every outcome (success or error) becomes an observable Observation.
   */
  private async executeTool(
    intent: ToolIntent,
    signal: AbortSignal,
  ): Promise<Observation> {
    for (let attempt = 0; attempt <= this.budget.maxRetries; attempt += 1) {
      try {
        const result = await this.tools.execute(intent, signal);
        return { intent, status: "success", result };
      } catch (error) {
        if (
          error instanceof ToolExecutionError &&
          isRetryable(error.code) &&
          attempt < this.budget.maxRetries
        ) {
          continue;
        }
        return {
          intent,
          status: "error",
          error: { code: errorCode(error), message: errorMessage(error) },
        };
      }
    }
    return {
      intent,
      status: "error",
      error: { code: "runtime_error", message: "Retry loop exhausted" },
    };
  }

  async *run(task: Task, callerSignal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const session = await this.sessions.createSession();
    const run: Run = {
      runId: randomUUID(),
      sessionId: session.id,
      task,
      status: "queued",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    session.runIds.push(run.runId);
    await this.sessions.saveSession(session);
    await this.runLog.saveRun(run);

    const context: DriveContext = {
      run,
      state: { task, messages: [], observations: [], iteration: 0 },
      sequence: 0,
      toolCalls: 0,
      startedAt: Date.now(),
    };

    yield* this.drive(context, callerSignal, [{ type: "run_started" }]);
  }

  async *resume(
    runId: string,
    input: unknown,
    callerSignal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const run = await this.runLog.loadRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== "awaiting_human") {
      throw new Error(`Run ${runId} is not awaiting human input`);
    }

    const events = await this.runLog.listEvents(runId);
    const state = replayAgentState(run.task, events);
    state.messages.push({ role: "human", input });

    const context: DriveContext = {
      run,
      state,
      sequence: events.length,
      toolCalls: events.filter((event) => event.type === "tool_completed").length,
      startedAt: run.startedAt,
    };

    yield* this.drive(context, callerSignal, [
      { type: "human_input_received", input },
      { type: "run_resumed" },
    ]);
  }

  private async emit(
    context: DriveContext,
    body: EventInput,
  ): Promise<AgentEvent> {
    const event = {
      ...body,
      runId: context.run.runId,
      sequence: context.sequence,
      timestamp: Date.now(),
    } as AgentEvent;
    context.sequence += 1;
    await this.runLog.appendEvent(event);
    return event;
  }

  private async setStatus(
    context: DriveContext,
    status: RunStatus,
  ): Promise<void> {
    context.run.status = status;
    context.run.updatedAt = Date.now();
    await this.runLog.saveRun(context.run);
  }

  private usageOf(context: DriveContext): Usage {
    return {
      toolCalls: context.toolCalls,
      durationMs: Date.now() - context.startedAt,
      model: this.model,
    };
  }

  private async *drive(
    context: DriveContext,
    callerSignal: AbortSignal | undefined,
    preamble: EventInput[],
  ): AsyncGenerator<AgentEvent> {
    const timeoutController = new AbortController();
    const timeoutId = scheduleTimeout(() => {
      const error = new Error("Timed out");
      error.name = "TimeoutError";
      timeoutController.abort(error);
    }, this.budget.timeoutMs);
    timeoutId.unref();
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      for (const body of preamble) {
        yield await this.emit(context, body);
      }
      await this.setStatus(context, "running");

      while (true) {
        if (signal.aborted) throw new Error("Aborted");

        if (context.state.iteration >= this.budget.maxIterations) {
          throw new RunBudgetError("budget_iterations", "Iteration budget exhausted");
        }
        if (context.toolCalls >= this.budget.maxToolCalls) {
          throw new RunBudgetError("budget_tools", "Tool-call budget exhausted");
        }

        yield await this.emit(context, { type: "model_requested", model: this.model });
        const decision = await this.core.step(context.state, signal);
        yield await this.emit(context, { type: "decision_made", decision });

        context.state.messages.push({ role: "assistant", decision });
        context.state.iteration += 1;

        if (decision.kind === "respond") {
          const content = decision.content as {
            outcome?: string;
            missingMaterial?: string[];
          };
          const status = content?.outcome === "partial" ? "partial" : "complete";
          await this.setStatus(context, "completed");
          yield await this.emit(context, {
            type: "run_completed",
            status,
            result: decision.content,
            missingMaterial: content?.missingMaterial,
          });
          yield await this.emit(context, {
            type: "usage_reported",
            usage: this.usageOf(context),
          });
          return;
        }

        if (decision.kind === "ask_human") {
          await this.setStatus(context, "awaiting_human");
          yield await this.emit(context, {
            type: "human_input_requested",
            question: decision.question,
          });
          // Paused: the run is durable and awaiting_human; resume() continues it.
          return;
        }

        if (decision.kind === "call_tool") {
          const intent = decision.intent;
          if (!this.tools.has(intent.name)) {
            await this.setStatus(context, "failed");
            yield await this.emit(context, {
              type: "run_failed",
              error: {
                code: "invalid_tool",
                message: `Tool "${intent.name}" is not in the allowlist`,
              },
            });
            yield await this.emit(context, {
              type: "usage_reported",
              usage: this.usageOf(context),
            });
            return;
          }

          const toolCallId = randomUUID();
          const toolStartedAt = Date.now();
          yield await this.emit(context, {
            type: "tool_started",
            toolCallId,
            toolName: intent.name,
          });
          context.toolCalls += 1;

          const observation = await this.executeTool(intent, signal);

          yield await this.emit(context, {
            type: "tool_completed",
            toolCallId,
            toolName: intent.name,
            status: observation.status,
            result: observation.result,
            error: observation.error,
            durationMs: Date.now() - toolStartedAt,
          });

          context.state.messages.push({ role: "tool", observation });
          context.state.observations.push(observation);
          yield await this.emit(context, {
            type: "observation_added",
            name: intent.name,
            observation,
          });
          continue;
        }

        // Defensive: the union above is exhaustive, but a misbehaving model
        // can still return something else at runtime.
        await this.setStatus(context, "failed");
        yield await this.emit(context, {
          type: "run_failed",
          error: {
            code: "no_progress",
            message: "Model returned a decision that made no progress",
          },
        });
        yield await this.emit(context, {
          type: "usage_reported",
          usage: this.usageOf(context),
        });
        return;
      }
    } catch (error) {
      if (callerSignal?.aborted) {
        await this.setStatus(context, "cancelled");
        yield await this.emit(context, { type: "run_cancelled" });
      } else if (signal.aborted) {
        await this.setStatus(context, "failed");
        yield await this.emit(context, {
          type: "run_failed",
          error: { code: "budget_timeout", message: "Run exceeded its time budget" },
        });
      } else if (error instanceof RunBudgetError) {
        await this.setStatus(context, "failed");
        yield await this.emit(context, {
          type: "run_failed",
          error: { code: error.code, message: error.message },
        });
      } else {
        await this.setStatus(context, "failed");
        yield await this.emit(context, {
          type: "run_failed",
          error: { code: errorCode(error), message: errorMessage(error) },
        });
      }
      yield await this.emit(context, {
        type: "usage_reported",
        usage: this.usageOf(context),
      });
      return;
    } finally {
      cancelTimeout(timeoutId);
    }
  }
}

/**
 * Reconstructs AgentState from an append-only event log. Replay is idempotent
 * when events are ordered by `sequence`.
 */
export function replayAgentState(task: Task, events: AgentEvent[]): AgentState {
  const state: AgentState = {
    task,
    messages: [],
    observations: [],
    iteration: 0,
  };
  for (const event of events) {
    if (event.type === "decision_made") {
      state.messages.push({ role: "assistant", decision: event.decision });
      state.iteration += 1;
    } else if (event.type === "observation_added") {
      const observation = event.observation as Observation;
      state.messages.push({ role: "tool", observation });
      state.observations.push(observation);
    } else if (event.type === "human_input_received") {
      state.messages.push({ role: "human", input: event.input });
    }
  }
  return state;
}
