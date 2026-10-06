import { parse as parseYaml } from "yaml";
import { CORE_FIELD_NAMES, type CoreFieldName } from "./fields";

export type RiskLevel = "high" | "medium" | "low";
export type CrossFieldSeverity = "must_fix" | "review";

export type FieldRule = {
  needsHumanReview: boolean;
  risk: RiskLevel;
  guidance?: string;
};

export type CrossFieldRule = {
  id: string;
  severity: CrossFieldSeverity;
  description: string;
};

export type DocumentConsistencyCatalog = {
  version: number;
  fields: Partial<Record<CoreFieldName, FieldRule>>;
  crossFieldRules: CrossFieldRule[];
};

const RISK_LEVELS: readonly RiskLevel[] = ["high", "medium", "low"];
const SEVERITIES: readonly CrossFieldSeverity[] = ["must_fix", "review"];

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is CrossFieldSeverity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}

type RawFieldRule = {
  needs_human_review?: unknown;
  risk?: unknown;
  guidance?: unknown;
};

type RawCrossFieldRule = {
  id?: unknown;
  severity?: unknown;
  description?: unknown;
  check?: unknown;
};

type RawFrontMatter = {
  version?: unknown;
  fields?: Record<string, RawFieldRule>;
  cross_field_rules?: RawCrossFieldRule[];
};

/** Extracts the YAML front-matter (between `---` fences) of a Skill markdown file. */
export function parseSkillFrontMatter(markdown: string): unknown {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith("---")) return {};
  const end = trimmed.indexOf("\n---", 3);
  const yamlBlock = end === -1 ? trimmed.slice(3) : trimmed.slice(3, end);
  return parseYaml(yamlBlock) ?? {};
}

export function parseCatalog(markdown: string): DocumentConsistencyCatalog {
  const fm = parseSkillFrontMatter(markdown) as RawFrontMatter;

  const fields: DocumentConsistencyCatalog["fields"] = {};
  for (const [name, raw] of Object.entries(fm.fields ?? {})) {
    if (!(CORE_FIELD_NAMES as readonly string[]).includes(name)) continue;
    fields[name as CoreFieldName] = {
      needsHumanReview: raw.needs_human_review === true,
      risk: isRiskLevel(raw.risk) ? raw.risk : "medium",
      guidance: typeof raw.guidance === "string" ? raw.guidance : undefined,
    };
  }

  const crossFieldRules: CrossFieldRule[] = (fm.cross_field_rules ?? [])
    .filter((rule) => typeof rule.id === "string")
    .map((rule) => ({
      id: rule.id as string,
      severity: isSeverity(rule.severity) ? rule.severity : "review",
      description:
        typeof rule.description === "string" ? rule.description : (rule.id as string),
    }));

  return {
    version: typeof fm.version === "number" ? fm.version : 1,
    fields,
    crossFieldRules,
  };
}

export function severityForRisk(
  risk: RiskLevel,
): "must_fix" | "review" | "display" {
  switch (risk) {
    case "high":
      return "must_fix";
    case "medium":
      return "review";
    case "low":
      return "display";
  }
}
