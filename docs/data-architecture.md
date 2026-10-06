# TradeLynk persistence architecture

## Product task

Given a shipment and its uploaded export documents, the user wants to run a
repeatable consistency check, resolve findings, replace documents, and retain
an auditable history showing how the shipment improved over time.

## Architecture decision

Supabase is a replaceable persistence adapter, not the domain model. The
application keeps lifecycle rules, validation rules, and issue transitions in
TypeScript. Supabase provides PostgreSQL persistence and private object storage.

All data access is server-side through repository interfaces. The browser uses
the Supabase anon key to sign in or register an email/password user, then sends
that user's access token to the application API. Every table and Storage object
is protected by owner-scoped RLS. The service-role key is not used by normal
application requests.

## Entity relationships

```text
Shipment 1 ── * Document
Shipment 1 ── * CheckRun
CheckRun * ── * Document       (check_run_documents snapshot)
CheckRun 1 ── * ExtractedField (per document, evidence included)
CheckRun 1 ── * ValidationResult
CheckRun 1 ── * Issue
ValidationResult 1 ── 0..1 Issue
CheckRun 1 ── * AgentRunEvent  (append-only trace)
Issue 0..1 ── 0..1 Issue       (previous occurrence across re-checks)
```

### Shipments

The aggregate root. It owns the user-facing name/reference and lifecycle:

```text
draft -> checking -> action_required -> ready_for_review
```

`action_required` means the latest completed run has unresolved findings.
`ready_for_review` means the latest completed run produced no open findings. It
does not mean compliant, approved, or cleared.

### Documents

One row per uploaded version. The PDF is stored in the private
`shipment-documents` bucket; the row stores type, name, size, storage path,
version, and status. Replacing a document creates a new row and marks the old
row `superseded`; deleting marks the row `deleted`. Historical check runs retain
their links to the exact versions that were checked.

Supported initial document types are commercial invoice, packing list, bill of
lading, certificate of origin, and other. Multiple documents of any type are
allowed.

### Check runs

An immutable attempt number within a shipment. A run moves through
`queued -> running -> completed | partial | failed | cancelled`. The latest
result is convenient to query, but previous runs are never overwritten.

### Extracted fields

Normalized values are separate from evidence. Each row stores the normalized
JSON value plus raw value, page, source quote, source unit, and confidence. This
is the durable boundary between content extraction and validation.

### Validation results

One deterministic result per checked field/rule. It stores the status,
reference value, values per document, and outliers. Validation code consumes
normalized extracted fields and does not read PDFs or call the model.

### Issues

Only actionable validation results become issues. Severity (`must_fix` or
`review`) is separate from workflow status:

```text
open -> reviewed -> resolved
```

Each re-check creates a new issue snapshot. A fingerprint links a recurring
finding to its previous occurrence. Unresolved issues that disappear after a
successful re-check are marked resolved by that run.

Manual review and resolution are deliberately different actions. A reviewer
may mark a finding `reviewed`, but a corrected document finding becomes
`resolved` only after a re-check no longer produces the same fingerprint. If a
difference is intentional, a reviewer can record it as an accepted exception;
that requires an audit note and stores the authenticated reviewer. Resolution
method distinguishes `recheck_cleared`, `recheck_persisted`, and
`accepted_exception` snapshots.

### Agent run events

The product-level Agent event stream is append-only and ordered by sequence.
It records decisions, tool activity, observations, termination, and missing
material without storing secrets. This is the durable trace for recovery and
audit; raw Pi SDK callbacks are not persisted as product contracts.

## Processing boundary

```text
private PDF object
  -> extraction adapter
  -> normalized ExtractedDocument + evidence
  -> pure validation rules
  -> ValidationResult rows
  -> issue classification and lifecycle update
  -> API DTO
  -> UI
```

The UI never interprets PDFs or recalculates validation. The extraction adapter
never decides severity. The validator never uploads files or writes to storage.

## Replacement and re-check workflow

1. Upload or replace a document; shipment returns to `draft`.
2. Start a check; shipment becomes `checking` and a new check run is created.
3. Snapshot the active document versions used by the run.
4. Persist extracted fields, validation results, issues, and Agent events.
5. Complete the run and set shipment to `action_required` or `ready_for_review`.
6. Close each older issue snapshot with a resolution method. If its fingerprint
   is absent, mark it `recheck_cleared`; if it remains, mark the old snapshot
   `recheck_persisted` and link the new open issue through `previous_issue_id`.

## Current implementation risks being removed

- `lib/shipments.ts`, `lib/results.ts`, and `lib/reviews.ts` use separate
  localStorage keys, so updates are not transactional and do not survive a new
  device/browser.
- The latest result overwrites the previous result, so no audit history exists.
- Selected PDF `File` objects live only in React state and disappear on reload.
- `/api/check` currently combines upload validation, extraction, Agent execution,
  comparison, and response mapping in one request handler.
- `lib/compare.ts` and `lib/agent/compare-dynamic.ts` are two validation paths
  with overlapping semantics; the Agent path should become canonical.
- Review decisions are keyed only by field name, so two issues for the same
  field cannot be tracked independently.
- Shipment status currently encodes implementation outcomes (`checked`,
  `check_failed`) instead of the requested product lifecycle.

## Transitional deployment

Required environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Enable email/password sign-ins in Supabase Auth, configure the permitted site
and redirect URLs, then apply the SQL migrations in order. Each authenticated
`auth.users` identity owns its rows; anonymous sign-ins are not required.
