"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  RefreshCcw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DiffText } from "@/components/diff-text";
import { DOC_KEYS, DOC_NAMES, type CheckResult } from "@/lib/types";

const STORAGE_KEY = "tradelynk:result";

const emptySubscribe = () => () => {};

let cachedSnapshot: {
  raw: string | null;
  value: CheckResult | null;
} | undefined;

function readResult(): CheckResult | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (cachedSnapshot?.raw === raw) {
      return cachedSnapshot.value;
    }
    const value = raw ? (JSON.parse(raw) as CheckResult) : null;
    cachedSnapshot = { raw, value };
    return value;
  } catch {
    return cachedSnapshot?.value ?? null;
  }
}

const getServerSnapshot = () => null;

function formatValue(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DocChip({ label, filename }: { label: string; filename?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium">{label}</span>
      {filename ? (
        <span className="max-w-44 truncate text-xs text-muted-foreground">
          {filename}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

export default function ResultsPage() {
  const result = useSyncExternalStore(
    emptySubscribe,
    readResult,
    getServerSnapshot,
  );
  const missing = !result;

  if (missing) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>No comparison found</CardTitle>
            <CardDescription>
              Upload your three PDFs first and run a comparison — the result
              page needs a completed check.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/">
                <ArrowLeft />
                Upload documents
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!result) return null;

  const errorCount = result.issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = result.issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const noFields = result.rows.length === 0;
  const issueMessageByField = new Map(
    result.issues.map((issue) => [
      issue.field,
      `${issue.severity === "error" ? "🔴" : "🟠"} ${issue.message}`,
    ]),
  );

  const statusTitle = noFields
    ? "No fields extracted"
    : result.issues.length === 0
      ? "All consistent"
      : `${errorCount} error${errorCount === 1 ? "" : "s"} · ${warningCount} warning${
          warningCount === 1 ? "" : "s"
        }`;

  const statusDescription = noFields
    ? "These documents look like blank templates — no values were found to compare."
    : result.issues.length === 0
      ? "All fields that are present on the documents match."
      : "Found inconsistencies that need review before shipment.";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            TradeLynk — Consistency Check
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            3 documents compared
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">
            <RefreshCcw />
            New check
          </Link>
        </Button>
      </header>

      <section
        className={`mb-8 rounded-xl border bg-card p-5 shadow-sm ${
          noFields
            ? "border-amber-300"
            : result.issues.length === 0
              ? "border-green-300"
              : "border-red-200"
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                noFields
                  ? "bg-amber-100 text-amber-600 dark:bg-amber-950"
                  : result.issues.length === 0
                    ? "bg-green-100 text-green-600 dark:bg-green-950"
                    : "bg-red-100 text-red-600 dark:bg-red-950"
              }`}
            >
              {noFields ? (
                <AlertCircle className="size-5" />
              ) : result.issues.length === 0 ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <AlertCircle className="size-5" />
              )}
            </span>
            <div>
              <p className="text-base font-semibold">{statusTitle}</p>
              <p className="text-sm text-muted-foreground">
                {statusDescription}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">3 documents</Badge>
            {errorCount > 0 && (
              <Badge variant="destructive">
                🔴 {errorCount} error{errorCount === 1 ? "" : "s"}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="secondary">
                🟠 {warningCount} warning{warningCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>
        {result.files && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            {DOC_KEYS.map((key) => (
              <DocChip
                key={key}
                label={DOC_NAMES[key]}
                filename={result.files?.[key]}
              />
            ))}
          </div>
        )}
      </section>

      {noFields ? (
        <Alert
          variant="destructive"
          className="mb-8 border-amber-300 bg-amber-50/60 dark:bg-amber-950/20"
        >
          <AlertCircle className="text-amber-600" />
          <AlertTitle>Check the uploaded files</AlertTitle>
          <AlertDescription>
            Make sure you upload the filled PDFs from{" "}
            <code>Document/filled/</code>, not the empty forms in{" "}
            <code>Document/</code>.
          </AlertDescription>
        </Alert>
      ) : result.issues.length === 0 ? (
        <Alert className="mb-8 border-green-300 bg-green-50/60 dark:bg-green-950/20">
          <CheckCircle2 className="text-green-600" />
          <AlertTitle>No inconsistencies found</AlertTitle>
          <AlertDescription>
            All fields that are present on the documents match.
          </AlertDescription>
        </Alert>
      ) : null}

      <section>
        <h2 className="mb-3 text-base font-semibold">
          Field-by-field comparison
        </h2>
        <TooltipProvider>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-56">Field</TableHead>
                  {DOC_KEYS.map((key) => (
                    <TableHead key={key} className="min-w-52">
                      <span className="block font-semibold">
                        {DOC_NAMES[key]}
                      </span>
                      {result.files?.[key] && (
                        <span className="mt-0.5 block max-w-52 truncate text-xs font-normal text-muted-foreground">
                          {result.files[key]}
                        </span>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow
                    key={row.key}
                    className={
                      row.consistent ? "" : "bg-red-50/40 dark:bg-red-950/10"
                    }
                  >
                    <TableCell className="whitespace-nowrap align-top font-medium">
                      <span className="flex items-center gap-1.5">
                        {row.consistent ? (
                          <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                        ) : (
                          <AlertCircle className="size-4 shrink-0 text-red-600" />
                        )}
                        {row.field}
                      </span>
                    </TableCell>
                    {DOC_KEYS.map((key) => {
                      const value = row.vals[key];
                      const present = value !== null && value !== "";
                      const highlight =
                        !row.consistent && present && row.outliers?.includes(key);
                      const canDiff =
                        highlight &&
                        typeof value === "string" &&
                        typeof row.reference === "string";
                      return (
                        <TableCell
                          key={key}
                          className={`min-w-48 max-w-96 align-top ${
                            present ? "" : "text-muted-foreground/50"
                          }`}
                          style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
                        >
                          {highlight ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  tabIndex={0}
                                  className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                >
                                  {canDiff ? (
                                    <DiffText
                                      value={value}
                                      reference={row.reference as string}
                                    />
                                  ) : (
                                    <span className="font-semibold text-red-600 dark:text-red-400">
                                      {formatValue(value)}
                                    </span>
                                  )}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                {issueMessageByField.get(row.field) ??
                                  "Value does not match the other documents."}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            formatValue(value)
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
          </div>
        </TooltipProvider>
      </section>

      <div className="mt-8">
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeft />
            Check another shipment
          </Link>
        </Button>
      </div>
    </main>
  );
}
