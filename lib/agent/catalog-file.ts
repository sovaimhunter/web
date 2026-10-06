import fs from "node:fs";
import path from "node:path";
import { parseCatalog, type DocumentConsistencyCatalog } from "./catalog";

export const DOCUMENT_CONSISTENCY_SKILL_PATH =
  ".agents/skills/document-consistency/SKILL.md";

/** Load the project-local document consistency policy used by the agent. */
export function loadDocumentConsistencyCatalog(
  projectRoot = process.cwd(),
): DocumentConsistencyCatalog {
  const skillPath = path.join(projectRoot, DOCUMENT_CONSISTENCY_SKILL_PATH);
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Document consistency Skill not found at ${skillPath}`);
  }
  return parseCatalog(fs.readFileSync(skillPath, "utf8"));
}
