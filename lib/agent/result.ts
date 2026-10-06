import type { DynamicComparison } from "./compare-dynamic";
import type { CheckFailure } from "../types";

export type AgentCheckResult = {
  outcome: "completed";
  comparison: DynamicComparison;
  files: Record<string, string>;
};

export type AgentFailedResult = {
  outcome: "failed";
  files: Partial<Record<string, string>>;
  failures: CheckFailure[];
};

export type StoredAgentResult = AgentCheckResult | AgentFailedResult;
