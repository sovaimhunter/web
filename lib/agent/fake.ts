import type {
  AgentState,
  Decision,
  ModelPort,
  ToolIntent,
  ToolPort,
} from "./types";

/**
 * Deterministic fake model: returns a scripted sequence of decisions. Used to
 * prove the Core loop and Runtime event ordering without a real LLM.
 */
export class ScriptedModelPort implements ModelPort {
  private cursor = 0;

  constructor(private readonly script: Decision[]) {}

  async decide(_state: AgentState, signal: AbortSignal): Promise<Decision> {
    signal.throwIfAborted();
    if (this.cursor >= this.script.length) {
      throw new Error("ScriptedModelPort exhausted: no decision left in script");
    }
    const decision = this.script[this.cursor];
    this.cursor += 1;
    return structuredClone(decision);
  }
}

/**
 * Deterministic fake tool set: maps tool names to handler functions.
 */
export class MapToolPort implements ToolPort {
  constructor(
    private readonly handlers: Record<
      string,
      (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
    >,
  ) {}

  async execute(intent: ToolIntent, signal: AbortSignal): Promise<unknown> {
    const handler = this.handlers[intent.name];
    if (!handler) {
      throw new Error(`MapToolPort: no handler for tool "${intent.name}"`);
    }
    return handler(intent.arguments, signal);
  }
}
