"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
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
import {
  DOC_KEYS,
  DOC_NAMES,
  type DocKey,
  type FieldRow,
  type FieldStatus,
} from "@/lib/types";
import { loadResult } from "@/lib/results";

const emptySubscribe = () => () => {};

const getServerSnapshot = () => null;

const STATUS_PRIORITY: Record<FieldStatus, number> = {
  mismatch: 0,
  review: 1,
  match: 2,
};

const DISPLAY_LABELS: Record<string, string> = {
  exporter: "Exporter details",
  consignee: "Importer / consignee details",
  description_of_goods: "Product description",
  hs_code: "HS code",
  country_of_origin: "Country of origin",
  incoterms: "Incoterms",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  vessel: "Vessel",
  unit_quantity: "Quantity",
  number_of_packages: "Package count",
  net_weight_kg: "Net weight",
  gross_weight_kg: "Gross weight",
  total_amount: "Invoice value",
  currency: "Currency",
};

type FieldGuidance = {
  why: string;
  check: string;
};

const DEFAULT_GUIDANCE: FieldGuidance = {
  why: "Different details across export documents can delay checks by customs, banks, or carriers.",
  check:
    "Confirm the correct value against your shipment records, then update the document that is incorrect.",
};

const FIELD_GUIDANCE: Record<string, FieldGuidance> = {
  exporter: {
    why: "Different exporter details can make the documents appear to refer to different legal entities.",
    check:
      "Confirm the exporter's legal name and address, including company suffixes, on every document.",
  },
  consignee: {
    why: "The consignee identifies who will receive the goods and may be used for customs clearance and delivery.",
    check:
      "Confirm the importer's legal name and address with the buyer, then correct the document that differs.",
  },
  description_of_goods: {
    why: "The goods description supports customs classification and helps carriers understand what is being shipped.",
    check:
      "Check that the product type, material, model, and quantity describe the same goods on all documents.",
  },
  hs_code: {
    why: "An inconsistent HS code can affect customs declarations, duty treatment, and import requirements.",
    check:
      "Confirm the intended HS code with your customs broker or classification source before updating the documents.",
  },
  country_of_origin: {
    why: "Country of origin can affect duties, trade preferences, and documentary requirements.",
    check:
      "Confirm where the goods were produced and use the same country of origin on all relevant documents.",
  },
  incoterms: {
    why: "Incoterms define who is responsible for transport costs, insurance, and risk during the shipment.",
    check:
      "Confirm the agreed Incoterm and named place in the sales contract or purchase order.",
  },
  port_of_loading: {
    why: "The port of loading should reflect the shipment's actual route and carrier booking.",
    check:
      "Compare the documents with the freight booking and confirm where the goods will be loaded.",
  },
  port_of_discharge: {
    why: "A different discharge port can cause routing, clearance, or delivery problems.",
    check:
      "Compare the documents with the freight booking and confirm the destination port with the consignee.",
  },
  vessel: {
    why: "Different vessel details may mean a document was prepared from an older or incorrect booking.",
    check:
      "Confirm the current vessel or voyage details against the carrier's latest booking confirmation.",
  },
  unit_quantity: {
    why: "Customs, the buyer, and the carrier need a consistent account of how many goods are being shipped.",
    check:
      "Confirm the shipped quantity and unit of measure, then correct the document that differs.",
  },
  number_of_packages: {
    why: "The package count should match the physical consignment accepted by the carrier.",
    check:
      "Count the cartons, crates, or pallets and compare the result with the packing and transport records.",
  },
  net_weight_kg: {
    why: "Net weight is used to describe the goods without packaging and may be required for customs reporting.",
    check:
      "Confirm the net weight and unit of measure from the final packing records.",
  },
  gross_weight_kg: {
    why: "Gross weight affects freight handling and should represent the goods together with their packaging.",
    check:
      "Confirm the final packed weight and unit of measure, then update the incorrect document.",
  },
  total_amount: {
    why: "The invoice value may be used for customs valuation, payment, insurance, and financial records.",
    check:
      "Recalculate the invoice lines and confirm the agreed sale value before correcting the total.",
  },
  currency: {
    why: "A different currency changes the meaning of the invoice value and can affect payment and customs valuation.",
    check:
      "Confirm the agreed transaction currency in the contract or purchase order and update the incorrect document.",
  },
};

function formatValue(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatIssueValue(
  row: FieldRow,
  key: DocKey,
  currency?: string | null,
): string {
  const value = row.vals[key];
  if (!isPresent(value)) return "—";
  if (typeof value !== "number") return value;

  const formatted = value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  if (row.key === "gross_weight_kg" || row.key === "net_weight_kg") {
    return `${formatted} kg`;
  }
  if (row.key === "total_amount" && currency) {
    return `${currency.toUpperCase()} ${formatted}`;
  }
  return formatted;
}

function isPresent(value: string | number | null): value is string | number {
  return value !== null && value !== undefined && value !== "";
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
  const [showMatched, setShowMatched] = useState(false);

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
  const problemCount = mismatchCount + reviewCount;
  const issueMessageByField = new Map(
    result.issues.map((issue) => [issue.field, issue.message]),
  );

  // Rows sorted so problems surface first; original field order is kept
  // within each status group (Array#sort is stable).
  const sortedRows = [...result.rows].sort(
    (a, b) => STATUS_PRIORITY[statusOf(a)] - STATUS_PRIORITY[statusOf(b)],
  );
  const visibleRows = showMatched
    ? sortedRows
    : sortedRows.filter((row) => statusOf(row) !== "match");
  const problemRows = sortedRows.filter(
    (row) => statusOf(row) !== "match",
  );
  const matchedRows = sortedRows.filter((row) => statusOf(row) === "match");

  const problemBreakdown = [
    mismatchCount > 0
      ? `${mismatchCount} must be corrected`
      : null,
    reviewCount > 0
      ? `${reviewCount} ${reviewCount === 1 ? "requires" : "require"} review`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const statusTitle = noFields
    ? "No fields extracted"
    : problemCount > 0
      ? `${problemCount} issue${problemCount === 1 ? "" : "s"} detected`
        : "All matched";

  const statusDescription = noFields
    ? "These documents look like blank templates — no values were found to compare."
    : problemCount > 0
      ? problemBreakdown
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
              ? "border-amber-200"
              : mismatchCount > 0
                ? "border-red-100 dark:border-red-900/40"
                : reviewCount > 0
                  ? "border-amber-200 dark:border-amber-900/40"
                  : "border-border"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                  noFields
                    ? "bg-amber-50 text-amber-500 dark:bg-amber-950"
                    : mismatchCount > 0
                      ? "bg-red-50 text-red-500 dark:bg-red-950"
                      : reviewCount > 0
                        ? "bg-amber-50 text-amber-500 dark:bg-amber-950"
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
                <Badge className="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                  {reviewCount} require{reviewCount === 1 ? "s" : ""} review
                </Badge>
              )}
              {mismatchCount > 0 && (
                <Badge className="bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                  {mismatchCount} mismatch{mismatchCount === 1 ? "" : "es"}
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
            className="mb-8 border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"
          >
            <AlertCircle className="text-amber-500" />
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

        {!noFields && (
          <>
            {problemRows.length > 0 && (
              <section aria-labelledby="issues-heading" className="mb-8">
                <div className="mb-3">
                  <h2 id="issues-heading" className="text-lg font-semibold">
                    Issues to address
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Review these items before the shipment proceeds.
                  </p>
                </div>
                <div className="space-y-4">
                  {problemRows.map((row) => {
                    const status = statusOf(row);
                    const guidance = FIELD_GUIDANCE[row.key] ?? DEFAULT_GUIDANCE;
                    const displayLabel = DISPLAY_LABELS[row.key] ?? row.field;
                    const presentKeys = DOC_KEYS.filter((key) =>
                      isPresent(row.vals[key]),
                    );
                    const isTie =
                      presentKeys.length > 1 &&
                      row.outliers.length === presentKeys.length;
                    const isMismatch = status === "mismatch";

                    return (
                      <article
                        key={row.key}
                        className={`overflow-hidden rounded-xl border bg-card shadow-sm ${
                          isMismatch
                            ? "border-red-200 dark:border-red-900/60"
                            : "border-amber-200 dark:border-amber-900/60"
                        }`}
                      >
                        <div className="flex flex-col gap-3 border-b bg-muted/20 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
                                isMismatch
                                  ? "bg-red-50 text-red-600 dark:bg-red-950"
                                  : "bg-amber-50 text-amber-600 dark:bg-amber-950"
                              }`}
                            >
                              {isMismatch ? (
                                <XCircle className="size-4" />
                              ) : (
                                <AlertCircle className="size-4" />
                              )}
                            </span>
                            <div>
                              <h3 className="font-semibold">
                                {displayLabel}{" "}
                                {isMismatch ? "mismatch" : "requires review"}
                              </h3>
                              {issueMessageByField.get(row.field) && (
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                  {issueMessageByField.get(row.field)}
                                </p>
                              )}
                            </div>
                          </div>
                          <Badge
                            className={
                              isMismatch
                                ? "w-fit bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                : "w-fit bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            }
                          >
                            {isMismatch ? "Must fix" : "Review"}
                          </Badge>
                        </div>

                        <div className="p-5">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {presentKeys.map((key) => (
                              <div
                                key={key}
                                className="rounded-lg border bg-muted/20 px-3.5 py-3"
                              >
                                <p className="text-xs font-medium text-muted-foreground">
                                  {DOC_NAMES[key]}
                                </p>
                                <p className="mt-1 break-words text-sm font-medium">
                                  {formatIssueValue(
                                    row,
                                    key,
                                    result.documents[key].currency,
                                  )}
                                </p>
                              </div>
                            ))}
                          </div>

                          {isTie && (
                            <p className="mt-3 text-sm text-muted-foreground">
                              TradeLynk cannot determine which value is correct
                              from these documents alone.
                            </p>
                          )}

                          <div className="mt-5 grid gap-4 border-t pt-4 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Why this matters
                              </p>
                              <p className="mt-1.5 text-sm leading-6">
                                {guidance.why}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                What to check
                              </p>
                              <p className="mt-1.5 text-sm leading-6">
                                {guidance.check}
                              </p>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {matchedRows.length > 0 && (
              <section aria-labelledby="matched-heading" className="mb-8">
                <div className="mb-3">
                  <h2 id="matched-heading" className="text-lg font-semibold">
                    Matched checks
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    These details were consistent wherever they appeared.
                  </p>
                </div>
                <div className="grid gap-2 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {matchedRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2.5 text-sm"
                    >
                      <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                      <span>
                        {DISPLAY_LABELS[row.key] ?? row.field} matched
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="comparison-heading">
              <div className="mb-3">
                <h2
                  id="comparison-heading"
                  className="text-base font-semibold"
                >
                  Full document comparison
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  View the extracted values from all three documents.
                </p>
              </div>
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
                      {visibleRows.map((row) => {
                        const status = statusOf(row);
                        const presentKeys = DOC_KEYS.filter((key) =>
                          isPresent(row.vals[key]),
                        );
                        // No majority: every document that has this field is
                        // flagged as an outlier, so there's no "correct" side —
                        // just disagreement to resolve, not a confirmed error.
                        const isTie =
                          status !== "match" &&
                          presentKeys.length > 1 &&
                          row.outliers.length === presentKeys.length;

                        return (
                          <TableRow
                            key={row.key}
                            className={
                              status === "mismatch"
                                ? "bg-red-50/25 dark:bg-red-950/10"
                                : status === "review"
                                  ? "bg-amber-50/30 dark:bg-amber-950/10"
                                  : ""
                            }
                          >
                            <TableCell className="whitespace-nowrap align-top font-medium">
                              <span className="flex items-center gap-1.5">
                                {status === "mismatch" ? (
                                  <XCircle className="size-4 shrink-0 text-red-500" />
                                ) : status === "review" ? (
                                  <AlertCircle className="size-4 shrink-0 text-amber-500" />
                                ) : (
                                  <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                {row.field}
                                <span
                                  className={`text-xs font-semibold ${
                                    status === "mismatch"
                                      ? "text-red-500"
                                      : status === "review"
                                        ? "text-amber-500"
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
                              const present = isPresent(value);
                              const isOutlier =
                                present && row.outliers?.includes(key);
                              const tone =
                                status === "review" ? "amber" : "red";
                              const toneText =
                                tone === "amber"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-red-600 dark:text-red-400";
                              const toneBg =
                                tone === "amber"
                                  ? "bg-amber-50 dark:bg-amber-950/20"
                                  : "bg-red-50 dark:bg-red-950/20";
                              const canDiff =
                                !isTie &&
                                typeof value === "string" &&
                                typeof row.reference === "string";

                              let cellContent: React.ReactNode = formatValue(
                                value,
                              );
                              if (status !== "match" && present) {
                                if (isTie) {
                                  // No consensus: highlight both sides the
                                  // same way, no check mark, no bold "winner".
                                  cellContent = (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          tabIndex={0}
                                          className={`rounded-sm px-1 py-0.5 outline-none ${toneBg} ${toneText} focus-visible:ring-2 focus-visible:ring-ring/60`}
                                        >
                                          {formatValue(value)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="max-w-xs"
                                      >
                                        Only {presentKeys.length} of 3
                                        documents have this field — can&apos;t
                                        tell which value is correct.
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                } else if (isOutlier) {
                                  // Background pill is the baseline "this one
                                  // is flagged" signal — always shown, even
                                  // when DiffText finds no char-level diff
                                  // (e.g. the outlier is just missing a
                                  // trailing part of the reference value).
                                  cellContent = (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          tabIndex={0}
                                          className={`rounded-sm px-1 py-0.5 outline-none ${toneBg} focus-visible:ring-2 focus-visible:ring-ring/60`}
                                        >
                                          {canDiff ? (
                                            <DiffText
                                              value={value}
                                              reference={row.reference as string}
                                              tone={tone}
                                            />
                                          ) : (
                                            <span
                                              className={`font-semibold ${toneText}`}
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
                                  );
                                } else {
                                  // Agrees with the majority.
                                  cellContent = (
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                      <Check className="size-3 shrink-0 text-muted-foreground/70" />
                                      {formatValue(value)}
                                    </span>
                                  );
                                }
                              }

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
                                  {cellContent}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                      {matchCount > 0 && (
                        <TableRow
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setShowMatched((v) => !v)}
                        >
                          <TableCell
                            colSpan={DOC_KEYS.length + 1}
                            className="text-sm text-muted-foreground"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {showMatched ? (
                                <ChevronUp className="size-4 shrink-0" />
                              ) : (
                                <ChevronRight className="size-4 shrink-0" />
                              )}
                              <Check className="size-3.5 shrink-0 text-muted-foreground/70" />
                              {matchCount} field{matchCount === 1 ? "" : "s"}{" "}
                              matched
                              {!showMatched && " — click to show"}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TooltipProvider>
            </section>
          </>
        )}
      </Main>
    </>
  );
}
