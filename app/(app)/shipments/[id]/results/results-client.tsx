"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  FileCheck2,
  FileText,
  History,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentCheckResult, AgentFailedResult } from "@/lib/agent/result";
import {
  humanizeField,
  partitionIssues,
  resolutionLabel,
  type IssueQueue,
} from "@/lib/persistence/issue-workflow";
import {
  runShipmentCheck,
  shipmentApi,
  updateIssue,
} from "@/lib/persistence/api-client";
import {
  SHIPMENT_STATUS_LABELS,
  type IssueRecord,
  type ShipmentDetail,
} from "@/lib/persistence/types";
import { cn } from "@/lib/utils";

type QueueFilter = keyof IssueQueue;

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "confirm", label: "Confirm" },
  { id: "resolved", label: "Resolved" },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not found";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDocumentId(id: string): string {
  return `Document ${id.slice(0, 8)}`;
}

export function ResultsClient({ shipmentId }: { shipmentId: string }) {
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>("todo");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [exceptionIssue, setExceptionIssue] = useState<IssueRecord | null>(null);
  const [exceptionNote, setExceptionNote] = useState("");

  const refresh = async () => setShipment(await shipmentApi.get(shipmentId));

  useEffect(() => {
    let cancelled = false;
    void shipmentApi
      .get(shipmentId)
      .then((detail) => {
        if (!cancelled) setShipment(detail);
      })
      .catch((value: unknown) => {
        if (!cancelled) {
          setError(value instanceof Error ? value.message : "Could not load results");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  const queues = useMemo(
    () => partitionIssues(shipment?.issues ?? [], shipment?.latestCheck?.id ?? null),
    [shipment],
  );
  const visibleIssues = queues[filter];

  const changeIssueStatus = async (
    issue: IssueRecord,
    status: "reviewed" | "resolved",
    note?: string,
  ) => {
    setUpdatingIssueId(issue.id);
    setError(null);
    try {
      await updateIssue({
        shipmentId,
        issueId: issue.id,
        status,
        note,
        resolutionMethod: status === "resolved" ? "accepted_exception" : undefined,
      });
      await refresh();
      if (status === "resolved") {
        setExceptionIssue(null);
        setExceptionNote("");
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not update issue");
    } finally {
      setUpdatingIssueId(null);
    }
  };

  const runAgain = async () => {
    if (!shipment || shipment.documents.length === 0) return;
    setChecking(true);
    setError(null);
    try {
      await runShipmentCheck(shipmentId);
      await refresh();
      setFilter("todo");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not run the check");
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <><Header title="Results" /><Main>Loading results…</Main></>;
  if (!shipment) return <><Header title="Results" /><Main>Shipment not found.</Main></>;

  const latest = shipment.latestCheck;
  const stored = latest?.result;
  const selectedIssue =
    visibleIssues.find((issue) => issue.id === selectedIssueId) ??
    visibleIssues[0] ??
    null;
  const documentNames = Object.assign(
    {},
    ...shipment.checkHistory.map((run) =>
      run.result?.outcome === "completed" ? run.result.files : {},
    ),
    Object.fromEntries(shipment.documents.map((document) => [document.id, document.originalName])),
  ) as Record<string, string>;

  return (
    <>
      <Header
        title="Document review"
        subtitle={`${shipment.name} · ${SHIPMENT_STATUS_LABELS[shipment.status]}`}
      />
      <Main className="mx-auto w-full max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" className="-ml-2">
            <Link href="/"><ArrowLeft />Back to shipments</Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/shipments/${shipmentId}/documents`}><FileText />Manage files</Link>
            </Button>
            <Button onClick={runAgain} disabled={checking || shipment.documents.length === 0}>
              {checking ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {checking ? "Checking documents…" : "Run check again"}
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-5">
            <AlertCircle />
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!latest || !stored ? (
          <Card>
            <CardHeader><CardTitle>No checks yet</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Upload documents and run the first check.</p></CardContent>
          </Card>
        ) : stored.outcome === "failed" ? (
          <FailedResult result={stored} />
        ) : (
          <CompletedResult
            result={stored}
            queues={queues}
            filter={filter}
            onFilter={setFilter}
            visibleIssues={visibleIssues}
            selectedIssue={selectedIssue}
            onSelectIssue={setSelectedIssueId}
            documentNames={documentNames}
            shipmentId={shipmentId}
            latestRunNumber={latest.runNumber}
            latestCreatedAt={latest.completedAt ?? latest.createdAt}
            updatingIssueId={updatingIssueId}
            onReview={(issue) => changeIssueStatus(issue, "reviewed")}
            onAccept={(issue) => {
              setExceptionIssue(issue);
              setExceptionNote("");
            }}
          />
        )}

        <HistoryAndComparison shipment={shipment} result={stored} />
      </Main>

      <Dialog
        open={Boolean(exceptionIssue)}
        onOpenChange={(open) => {
          if (!open && !updatingIssueId) {
            setExceptionIssue(null);
            setExceptionNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record this difference as expected?</DialogTitle>
            <DialogDescription>
              This closes the finding by reviewer decision, not by a successful re-check.
              Add enough context for a future auditor to understand why.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            Audit note
            <textarea
              value={exceptionNote}
              onChange={(event) => setExceptionNote(event.target.value)}
              placeholder="Example: The buyer uses its registered import entity on the bill of lading."
              rows={5}
              className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button
              disabled={exceptionNote.trim().length < 3 || !exceptionIssue || Boolean(updatingIssueId)}
              onClick={() => {
                if (exceptionIssue) void changeIssueStatus(exceptionIssue, "resolved", exceptionNote);
              }}
            >
              {updatingIssueId ? <LoaderCircle className="animate-spin" /> : <Check />}
              Record as expected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FailedResult({ result }: { result: AgentFailedResult }) {
  return (
    <section className="space-y-3">
      {result.failures.map((failure, index) => (
        <Alert key={`${failure.code}-${index}`} variant="destructive">
          <AlertCircle />
          <AlertTitle>{failure.message}</AlertTitle>
          <AlertDescription>{failure.action}</AlertDescription>
        </Alert>
      ))}
    </section>
  );
}

function CompletedResult({
  result,
  queues,
  filter,
  onFilter,
  visibleIssues,
  selectedIssue,
  onSelectIssue,
  documentNames,
  shipmentId,
  latestRunNumber,
  latestCreatedAt,
  updatingIssueId,
  onReview,
  onAccept,
}: {
  result: AgentCheckResult;
  queues: IssueQueue;
  filter: QueueFilter;
  onFilter: (filter: QueueFilter) => void;
  visibleIssues: IssueRecord[];
  selectedIssue: IssueRecord | null;
  onSelectIssue: (id: string) => void;
  documentNames: Record<string, string>;
  shipmentId: string;
  latestRunNumber: number;
  latestCreatedAt: string;
  updatingIssueId: string | null;
  onReview: (issue: IssueRecord) => void;
  onAccept: (issue: IssueRecord) => void;
}) {
  const mustFixCount = queues.todo.filter((issue) => issue.severity === "must_fix").length;
  const passedCount = result.comparison.rows.filter((row) => row.status === "passed").length;

  return (
    <>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Latest check summary">
        <SummaryCard icon={<AlertTriangle className="size-5" />} label="Must fix" value={mustFixCount} tone={mustFixCount > 0 ? "danger" : "neutral"} />
        <SummaryCard icon={<FileCheck2 className="size-5" />} label="Needs confirmation" value={queues.confirm.length} tone={queues.confirm.length > 0 ? "warning" : "neutral"} />
        <SummaryCard icon={<CheckCircle2 className="size-5" />} label="Passed comparisons" value={passedCount} tone="success" />
        <SummaryCard icon={<Clock3 className="size-5" />} label={`Latest check #${latestRunNumber}`} value={formatDate(latestCreatedAt)} tone="neutral" compact />
      </section>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Issue workbench</h2>
          <p className="text-sm text-muted-foreground">Investigate evidence, correct source files, then re-run the check.</p>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">Document consistency only — not legal approval</p>
      </div>

      <section className="grid min-h-[570px] overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.6fr)]">
        <div className="border-b bg-muted/20 lg:border-r lg:border-b-0">
          <div className="grid grid-cols-3 border-b p-2">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onFilter(item.id)}
                aria-pressed={filter === item.id}
                className={cn(
                  "rounded-lg px-2 py-2 text-left transition-colors",
                  filter === item.id
                    ? "bg-background shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
              >
                <span className="flex items-center justify-between gap-1 text-xs font-medium sm:text-sm">
                  {item.label}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{queues[item.id].length}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="max-h-[560px] overflow-y-auto p-2">
            {visibleIssues.length === 0 ? (
              <QueueEmpty filter={filter} />
            ) : (
              <div className="space-y-2">
                {visibleIssues.map((issue) => (
                  <IssueQueueItem
                    key={issue.id}
                    issue={issue}
                    active={issue.id === selectedIssue?.id}
                    documentNames={documentNames}
                    onClick={() => onSelectIssue(issue.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
          {selectedIssue ? (
            <IssueDetail
              issue={selectedIssue}
              documentNames={documentNames}
              shipmentId={shipmentId}
              updating={updatingIssueId === selectedIssue.id}
              onReview={() => onReview(selectedIssue)}
              onAccept={() => onAccept(selectedIssue)}
            />
          ) : (
            <div className="flex min-h-[440px] items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <CheckCircle2 className="mx-auto mb-3 size-9 text-emerald-600" />
                <h3 className="font-semibold">Nothing in this queue</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {filter === "resolved"
                    ? "Resolved findings will appear here after a re-check or an audited reviewer decision."
                    : "Choose another queue or run the check again after changing a document."}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function SummaryCard({ icon, label, value, tone, compact = false }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "danger" | "warning" | "success" | "neutral";
  compact?: boolean;
}) {
  const toneClass = {
    danger: "border-red-200 bg-red-50/60 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300",
    warning: "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300",
    success: "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300",
    neutral: "text-foreground",
  }[tone];
  return (
    <div className={cn("rounded-xl border bg-card p-4", toneClass)}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">{icon}{label}</div>
      <p className={cn("mt-2 font-semibold", compact ? "text-sm" : "text-2xl tabular-nums")}>{value}</p>
    </div>
  );
}

function QueueEmpty({ filter }: { filter: QueueFilter }) {
  const copy = {
    todo: "No active differences need action.",
    confirm: "No consistent values are waiting for confirmation.",
    resolved: "No findings have been resolved yet.",
  }[filter];
  return <p className="px-3 py-8 text-center text-sm text-muted-foreground">{copy}</p>;
}

function IssueQueueItem({ issue, active, documentNames, onClick }: {
  issue: IssueRecord;
  active: boolean;
  documentNames: Record<string, string>;
  onClick: () => void;
}) {
  const affected = issue.outlierDocumentIds[0];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40",
        active && "border-primary/50 bg-primary/5 ring-1 ring-primary/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-tight">{humanizeField(issue.fieldKey)}</p>
        <span className={cn(
          "mt-0.5 size-2 shrink-0 rounded-full",
          issue.status === "resolved" ? "bg-emerald-500" : issue.severity === "must_fix" ? "bg-red-500" : "bg-amber-500",
        )} />
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{issue.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {issue.status === "resolved" ? (
          <Badge variant="outline">{resolutionLabel(issue)}</Badge>
        ) : (
          <>
            <Badge variant={issue.severity === "must_fix" ? "destructive" : "secondary"}>{issue.severity === "must_fix" ? "Must fix" : "Review"}</Badge>
            {issue.status === "reviewed" && <Badge variant="outline">Reviewed</Badge>}
          </>
        )}
      </div>
      {affected && <p className="mt-2 truncate text-[11px] text-muted-foreground">{documentNames[affected] ?? shortDocumentId(affected)}</p>}
    </button>
  );
}

function IssueDetail({ issue, documentNames, shipmentId, updating, onReview, onAccept }: {
  issue: IssueRecord;
  documentNames: Record<string, string>;
  shipmentId: string;
  updating: boolean;
  onReview: () => void;
  onAccept: () => void;
}) {
  const affectedDocumentId = issue.outlierDocumentIds[0];
  const affectedName = affectedDocumentId ? documentNames[affectedDocumentId] ?? shortDocumentId(affectedDocumentId) : null;
  const isResolved = issue.status === "resolved";
  const isAcceptedException = issue.resolutionMethod === "accepted_exception";

  return (
    <article>
      <div className="border-b p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected finding</p>
            <h3 className="mt-1 text-xl font-semibold">{humanizeField(issue.fieldKey)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{issue.message}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant={issue.severity === "must_fix" ? "destructive" : "secondary"}>{issue.severity === "must_fix" ? "Must fix" : "Review"}</Badge>
            <Badge variant="outline">{isResolved ? resolutionLabel(issue) : issue.status}</Badge>
          </div>
        </div>
        <IssueProgress issue={issue} />
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <section aria-labelledby={`evidence-${issue.id}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h4 id={`evidence-${issue.id}`} className="font-semibold">Cross-document evidence</h4>
              <p className="text-xs text-muted-foreground">Values and source excerpts captured during extraction.</p>
            </div>
            <Badge variant="outline">{Object.keys(issue.valuesByDocument).length} documents</Badge>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Extracted value</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
              <TableBody>
                {Object.entries(issue.valuesByDocument).map(([documentId, value]) => {
                  const evidence = issue.evidenceByDocument[documentId] as { page?: number; quote?: string; confidence?: number } | undefined;
                  const outlier = issue.outlierDocumentIds.includes(documentId);
                  return (
                    <TableRow key={documentId} className={outlier ? "bg-red-50/60 dark:bg-red-950/15" : undefined}>
                      <TableCell className="min-w-48 align-top">
                        <div className="flex items-start gap-2">
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{documentNames[documentId] ?? shortDocumentId(documentId)}</p>
                            {outlier && <p className="mt-0.5 text-xs font-medium text-red-600 dark:text-red-400">Needs attention</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cn("min-w-44 align-top", outlier && "font-semibold text-red-700 dark:text-red-300")}>{formatValue(value)}</TableCell>
                      <TableCell className="min-w-56 align-top text-xs text-muted-foreground">
                        {evidence?.page ? <p>Page {evidence.page}{typeof evidence.confidence === "number" ? ` · ${Math.round(evidence.confidence * 100)}% confidence` : ""}</p> : null}
                        {evidence?.quote ? <p className="mt-1 line-clamp-3 italic">“{evidence.quote}”</p> : <p>No source excerpt</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="rounded-lg border bg-muted/30 p-4" aria-label="Recommended next step">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended next step</p>
          <p className="mt-1 text-sm">
            {affectedName
              ? `Verify ${affectedName} against the source record. If it is wrong, replace that PDF and run the check again.`
              : "Confirm the value against the source record. Record it as expected only when the difference is intentional."}
          </p>
        </section>

        {isResolved ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/15">
            <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" />{resolutionLabel(issue)}</div>
            {issue.resolutionNote && <p className="mt-2 text-sm">{issue.resolutionNote}</p>}
            {issue.resolvedAt && <p className="mt-2 text-xs text-muted-foreground">{formatDate(issue.resolvedAt)}</p>}
          </section>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t pt-5">
            {affectedDocumentId && (
              <Button asChild>
                <Link href={`/shipments/${shipmentId}/documents?focus=${affectedDocumentId}`}><RefreshCw />Replace affected file</Link>
              </Button>
            )}
            <Button variant="outline" disabled={updating || issue.status === "reviewed"} onClick={onReview}>
              {updating ? <LoaderCircle className="animate-spin" /> : <Check />}
              {issue.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
            </Button>
            <Button variant="ghost" disabled={updating} onClick={onAccept}>Record as expected</Button>
            <p className="basis-full text-xs text-muted-foreground">Replacing a file does not close the finding. A new check must verify the correction.</p>
          </div>
        )}
        {isAcceptedException && issue.reviewedBy && <p className="text-xs text-muted-foreground">Reviewer recorded in the audit log.</p>}
      </div>
    </article>
  );
}

function IssueProgress({ issue }: { issue: IssueRecord }) {
  const reviewed = Boolean(issue.reviewedAt) || issue.status === "reviewed" || issue.status === "resolved";
  const rechecked = Boolean(issue.resolvedByCheckRunId);
  const resolved = issue.status === "resolved";
  const steps = [
    { label: "Open", done: true },
    { label: "Reviewed", done: reviewed },
    { label: issue.resolutionMethod === "accepted_exception" ? "Decision" : "Rechecked", done: rechecked || issue.resolutionMethod === "accepted_exception" },
    { label: "Resolved", done: resolved },
  ];
  return (
    <div className="mt-5 grid grid-cols-4 gap-1" aria-label="Issue progress">
      {steps.map((step, index) => (
        <div key={step.label} className="relative flex flex-col items-center gap-1 text-center">
          {index > 0 && <span className={cn("absolute top-2 right-1/2 h-px w-full", step.done ? "bg-emerald-400" : "bg-border")} />}
          <span className={cn("relative z-10 flex size-4 items-center justify-center rounded-full bg-card", step.done ? "text-emerald-600" : "text-muted-foreground")}>
            {step.done ? <CheckCircle2 className="size-4 fill-emerald-50 dark:fill-emerald-950" /> : <Circle className="size-3.5" />}
          </span>
          <span className={cn("text-[11px]", step.done ? "font-medium text-foreground" : "text-muted-foreground")}>{step.label}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryAndComparison({ shipment, result }: {
  shipment: ShipmentDetail;
  result: AgentCheckResult | AgentFailedResult | null | undefined;
}) {
  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-2">
      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <span className="flex items-center gap-2 font-semibold"><History className="size-4" />Check history</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2 border-t p-4">
          {shipment.checkHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous checks.</p>
          ) : shipment.checkHistory.map((run) => (
            <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <div><p className="text-sm font-medium">Check #{run.runNumber}</p><p className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</p></div>
              <div className="flex items-center gap-2"><Badge variant="outline">{run.status}</Badge><span className="text-sm">{run.issueCount} issue{run.issueCount === 1 ? "" : "s"}</span></div>
            </div>
          ))}
        </div>
      </details>

      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <span className="flex items-center gap-2 font-semibold"><FileCheck2 className="size-4" />All compared fields</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="max-h-96 overflow-auto border-t">
          {result?.outcome === "completed" ? (
            <Table>
              <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {result.comparison.rows.map((row) => (
                  <TableRow key={row.field}><TableCell className="font-medium">{humanizeField(row.field)}</TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="p-4 text-sm text-muted-foreground">No completed comparison is available.</p>}
        </div>
      </details>
    </div>
  );
}
