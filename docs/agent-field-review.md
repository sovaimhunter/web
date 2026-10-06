# Agent field-semantic review

## Product task

Given one export PDF and its first-pass structured extraction, the user wants
misclassified values corrected before cross-document comparison, and the Agent
is useful when an unsupported field value is either replaced from source
evidence or removed without entering an unbounded retry loop.

## Smallest loop

```text
PDF
  -> extract_file (full first pass)
  -> Agent reviews field name + normalized value + source evidence
  -> valid: keep observation
  -> suspicious: extract_file once for only the suspicious fields
  -> replace those fields (including with null when absent)
  -> deterministic cross-document comparison
```

The Agent reviews semantic assignment only. A valid disagreement between two
documents remains comparison evidence and must not trigger re-extraction.

## Core and Runtime boundary

- `ExtractedDocument` remains the normalized Core observation with provenance.
- The Pi model decides whether a returned value semantically fits its field.
- `extract_file` is the only allowed action. Its runtime wrapper permits one
  full extraction and at most one targeted correction per PDF.
- A targeted correction replaces only named fields; all unrelated first-pass
  values remain unchanged. An omitted corrected field becomes `null`.
- `compareExtractedDocuments` remains deterministic and never reads PDFs or
  calls a model.

## Pi SDK adapter mapping

| Product contract | Pi SDK surface |
|---|---|
| Review decision | `AgentSession.prompt(...)` and the model transcript |
| Extraction action | `defineTool({ name: "extract_file", ... })` |
| Tool arguments | TypeBox `{ file, fields? }` schema |
| Cancellation | SDK-provided `signal` passed through `adaptTool` to `ToolPort` |
| Observation | Tool `details` mapped to product `observation_added` events |
| Audit trace | Existing ordered `AgentEvent` stream persisted with the run |

Raw SDK events stay behind `mapPiEvent`. The model cannot bypass the runtime
attempt budget: a third extraction for the same PDF fails with `budget_tools`.

## Failure and limitations

- If the semantic review model misses a bad assignment, deterministic
  comparison may still surface it as a discrepancy for human review.
- If the single targeted retry cannot find valid source evidence, the field is
  cleared rather than preserving the known-suspicious value.
- The same default model currently performs Agent review and PDF extraction,
  but they are separate calls with separate prompts. Cross-document comparison
  remains code-based.
