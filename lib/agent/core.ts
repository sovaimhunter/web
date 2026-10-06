import type {
  AgentCore,
  AgentState,
  Decision,
  ModelPort,
} from "./types";

/**
 * The Core only answers "what is the next decision?" It delegates to the model
 * port and keeps no state of its own. Strategy, tool execution, and persistence
 * belong to the Runtime or the injected ports.
 */
export class Core implements AgentCore {
  constructor(private readonly model: ModelPort) {}

  step(state: AgentState, signal: AbortSignal): Promise<Decision> {
    return this.model.decide(state, signal);
  }
}
