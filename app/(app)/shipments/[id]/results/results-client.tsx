"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  RefreshCcw,
  XCircle,
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
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { DOC_KEYS, DOC_NAMES, type FieldRow, type FieldStatus } from "@/lib/types";
import { loadResult } from "@/lib/results";

const emptySubscribe = () => () => {};

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

export function ResultsClient({ shipmentId }: { shipmentId: string }) {
  const result = useSyncExternalStore(
    emptySubscribe,
    () => loadResult(shipmentId),
    getServerSnapshot,
  );

  if (!result) {
    return (
      <>
        <Header title="Results" />
        <Main className="mx-auto w-full max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>No results found</CardTitle>
              <CardDescription>
                Run the document check first — the results page needs a
                completed check.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/shipments/${shipmentId}/documents`}>
                  <ArrowLeft />
                  Upload documents
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Main>
      </>
    );
  }

  const noFields = result.rows.length === 0;
  const statusOf = (row: FieldRow): FieldStatus => {
    if (row.status) return row.status;
    const issue = result.issues.find((i) => i.field === row.field);
    if (issue) return issue.severity === "error" ? "mismatch" : "review";
    return row.consistent ? "match" : "review";
  };
  const matchCount = result.rows.filter(
    (row) => statusOf(row) === "match",
  ).length;
  const reviewCount = result.rows.filter(
    (row) => statusOf(row) === "review",
  ).length;
  const mismatchCount = result.rows.filter(
    (row) => statusOf(row) === "mismatch",
  ).length;
  const issueMessageByField = new Map(
    result.issues.map((issue) => [
      issue.field,
      `${issue.severity === "error" ? "🔴" : "🟠"} ${issue.message}`,
    ]),
  );

  const statusTitle = noFields
    ? "No fields extracted"
    : mismatchCount > 0
      ? `${mismatchCount} mismatch${mismatchCount === 1 ? "" : "es"}${
          reviewCount > 0
            ? ` · ${reviewCount} review${reviewCount === 1 ? "" : "s"}`
            : ""
        }`
      : reviewCount > 0
        ? `${reviewCount} require${reviewCount === 1 ? "s" : ""} review`
        : "All matched";

  const statusDescription = noFields
    ? "These documents look like blank templates — no values were found to compare."
    : mismatchCount > 0
      ? "Fields differ and need correction before shipment."
      : reviewCount > 0
        ? "Fields are close but should be reviewed before shipping."
        : "All fields that are present on the documents match.";

  return (
    <>
      <Header title="Results" subtitle="View results · Step 4 of 4" />
      <Main className="mx-auto w-full max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Consistency Check Results
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              3 documents compared
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/shipments/${shipmentId}/documents`}>
                <RefreshCcw />
                Re-check
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft />
                All shipments
              </Link>
            </Button>
          </div>
        </div>

        <section
          className={`mb-8 rounded-xl border bg-card p-5 shadow-sm ${
            noFields
              ? "border-amber-300"
              : mismatchCount > 0
                ? "border-red-200"
                : reviewCount > 0
                  ? "border-amber-300"
                  : "border-border"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                  noFields
                    ? "bg-amber-100 text-amber-600 dark:bg-amber-950"
                    : mismatchCount > 0
                      ? "bg-red-100 text-red-600 dark:bg-red-950"
                      : reviewCount > 0
                        ? "bg-amber-100 text-amber-600 dark:bg-amber-950"
                        : "bg-muted text-muted-foreground"
                }`}
              >
                {mismatchCount > 0 || noFields ? (
                  <AlertCircle className="size-5" />
                ) : reviewCount > 0 ? (
                  <AlertCircle className="size-5" />
                ) : (
                  <CheckCircle2 className="size-5" />
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
              {matchCount > 0 && (
                <Badge
                  variant="secondary"
                  className="bg-muted text-muted-foreground"
                >
                  {matchCount} matched
                </Badge>
              )}
              {reviewCount > 0 && (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  🟡 {reviewCount} require{reviewCount === 1 ? "s" : ""} review
                </Badge>
              )}
              {mismatchCount > 0 && (
                <Badge variant="destructive">
                  🔴 {mismatchCount} mismatch{mismatchCount === 1 ? "" : "es"}
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
        ) : mismatchCount === 0 && reviewCount === 0 ? (
          <Alert className="mb-8 border-border bg-muted/40">
            <CheckCircle2 className="text-muted-foreground" />
            <AlertTitle>All fields matched</AlertTitle>
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
                    {result.rows.map((row) => {
                      const status = statusOf(row);
                      return (
                        <TableRow
                          key={row.key}
                          className={
                            status === "mismatch"
                              ? "bg-red-50/40 dark:bg-red-950/10"
                              : status === "review"
                                ? "bg-amber-50/50 dark:bg-amber-950/10"
                                : ""
                          }
                        >
                          <TableCell className="whitespace-nowrap align-top font-medium">
                            <span className="flex items-center gap-1.5">
                              {status === "mismatch" ? (
                                <XCircle className="size-4 shrink-0 text-red-600" />
                              ) : status === "review" ? (
                                <AlertCircle className="size-4 shrink-0 text-amber-500" />
                              ) : (
                                <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                              )}
                              {row.field}
                              <span
                                className={`text-xs font-semibold ${
                                  status === "mismatch"
                                    ? "text-red-600"
                                    : status === "review"
                                      ? "text-amber-600"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {status === "mismatch"
                                  ? "mismatch"
                                  : status === "review"
                                    ? "review"
                                    : "match"}
                              </span>
                            </span>
                          </TableCell>
                          {DOC_KEYS.map((key) => {
                            const value = row.vals[key];
                            const present = value !== null && value !== "";
                            const highlight =
                              status !== "match" &&
                              present &&
                              row.outliers?.includes(key);
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
                                style={{
                                  whiteSpace: "normal",
                                  overflowWrap: "anywhere",
                                }}
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
                                            tone={
                                              status === "review"
                                                ? "amber"
                                                : "red"
                                            }
                                          />
                                        ) : (
                                          <span
                                            className={`font-semibold ${
                                              status === "review"
                                                ? "text-amber-600 dark:text-amber-400"
                                                : "text-red-600 dark:text-red-400"
                                            }`}
                                          >
                                            {formatValue(value)}
                                          </span>
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="max-w-xs"
                                    >
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
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TooltipProvider>
        </section>
      </Main>
    </>
  );
}
