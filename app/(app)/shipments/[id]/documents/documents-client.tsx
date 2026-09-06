"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { WorkflowSteps } from "@/components/workflow-steps";
import {
  DOC_KEYS,
  DOC_NAMES,
  MAX_UPLOAD_TOTAL_BYTES,
  type CheckErrorResponse,
  type CheckFailure,
  type CheckResult,
  type DocKey,
} from "@/lib/types";
import { getShipmentCached, updateShipment } from "@/lib/shipments";
import { saveResult } from "@/lib/results";

const emptySubscribe = () => () => {};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsClient({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const shipment = useSyncExternalStore(
    emptySubscribe,
    () => getShipmentCached(shipmentId),
    () => null,
  );
  const inputRefs = useRef<Partial<Record<DocKey, HTMLInputElement | null>>>(
    {},
  );
  const [files, setFiles] = useState<Partial<Record<DocKey, File>>>({});
  const [dragging, setDragging] = useState<Partial<Record<DocKey, boolean>>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<CheckFailure[]>([]);

  const readyCount = DOC_KEYS.filter((key) => files[key]).length;

  const setFileFailure = useCallback((failure: CheckFailure) => {
    setFailures((previous) => [
      ...previous.filter((item) => item.document !== failure.document),
      failure,
    ]);
  }, []);

  const acceptFile = useCallback((key: DocKey, file: File | undefined) => {
    if (!file) return;
    setFailures((previous) =>
      previous.filter(
        (failure) => failure.document !== key && failure.document !== undefined,
      ),
    );
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setFileFailure({
        code: "INVALID_FILE_TYPE",
        stage: "upload",
        document: key,
        message: `${DOC_NAMES[key]} must be a PDF file.`,
        action: "Choose a PDF file instead.",
        retryable: false,
      });
      return;
    }
    if (file.size === 0) {
      setFileFailure({
        code: "EMPTY_FILE",
        stage: "upload",
        document: key,
        message: `${DOC_NAMES[key]} is empty.`,
        action: "Choose a non-empty PDF.",
        retryable: false,
      });
      return;
    }
    setFiles((prev) => ({ ...prev, [key]: file }));
  }, [setFileFailure]);

  const removeFile = useCallback((key: DocKey) => {
    setFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFailures((previous) =>
      previous.filter(
        (failure) => failure.document !== key && failure.document !== undefined,
      ),
    );
  }, []);

  const handleDrop = useCallback(
    (key: DocKey, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (loading) return;
      setDragging((prev) => ({ ...prev, [key]: false }));
      acceptFile(key, event.dataTransfer.files[0]);
    },
    [acceptFile, loading],
  );

  const handleCompare = async () => {
    const missing = DOC_KEYS.filter((key) => !files[key]);
    if (missing.length > 0) {
      setFailures(
        missing.map((key) => ({
          code: "MISSING_DOCUMENT",
          stage: "upload",
          document: key,
          message: `${DOC_NAMES[key]} is missing.`,
          action: `Add the ${DOC_NAMES[key]} before running the check.`,
          retryable: true,
        })),
      );
      return;
    }

    const totalBytes = DOC_KEYS.reduce(
      (sum, key) => sum + (files[key]?.size ?? 0),
      0,
    );
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      setFailures([
        {
          code: "UPLOAD_TOO_LARGE",
          stage: "upload",
          message: `The three PDFs total ${formatSize(totalBytes)}, over the ${formatSize(
            MAX_UPLOAD_TOTAL_BYTES,
          )} upload limit.`,
          action: "Compress the PDFs or replace them with smaller files.",
          retryable: false,
        },
      ]);
      return;
    }

    setLoading(true);
    setFailures([]);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const formData = new FormData();
      for (const key of DOC_KEYS) formData.append(key, files[key]!);

      const response = await fetch("/api/check", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      // Platform-level errors (e.g. a 413 from Vercel's edge) are not JSON,
      // so fall back to a readable message instead of a JSON parse error.
      const data = (await response.json().catch(() => null)) as
        | CheckResult
        | CheckErrorResponse
        | null;
      if (!response.ok) {
        const responseFailures =
          data && "failures" in data ? data.failures : undefined;
        const responseMessage =
          data && "error" in data ? data.error : undefined;
        const nextFailures: CheckFailure[] = responseFailures?.length
          ? responseFailures
          : [
              {
                code:
                  response.status === 413
                    ? "UPLOAD_TOO_LARGE"
                    : "CHECK_FAILED",
                stage: response.status === 413 ? "upload" : "comparison",
                message:
                  responseMessage ??
                  (response.status === 413
                    ? "The uploaded PDFs are too large."
                    : `The document check failed (HTTP ${response.status}).`),
                action:
                  response.status === 413
                    ? "Compress the PDFs or replace them with smaller files."
                    : "Try the check again.",
                retryable: response.status !== 413,
              },
            ];
        const checkReachedResults = nextFailures.some(
          (failure) =>
            failure.stage === "extraction" || failure.stage === "comparison",
        );
        if (checkReachedResults) {
          saveResult(shipmentId, {
            outcome: "failed",
            files: Object.fromEntries(
              DOC_KEYS.map((key) => [key, files[key]!.name]),
            ),
            failures: nextFailures,
          });
          updateShipment(shipmentId, {
            status: "check_failed",
            mustFixCount: 0,
            reviewCount: 0,
          });
          router.push(`/shipments/${shipmentId}/results`);
        } else {
          setFailures(nextFailures);
        }
        return;
      }
      if (!data) {
        throw new Error("The server returned an unreadable response.");
      }

      const result = data as CheckResult;
      saveResult(shipmentId, result);
      const mustFix = result.issues.filter(
        (issue) => issue.status === "must_fix",
      ).length;
      const reviews = result.issues.filter(
        (issue) => issue.status === "review",
      ).length;
      updateShipment(shipmentId, {
        status: "checked",
        mustFixCount: mustFix,
        reviewCount: reviews,
      });
      router.push(`/shipments/${shipmentId}/results`);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setFailures([
        {
          code: timedOut ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR",
          stage: "extraction",
          message: timedOut
            ? "The document check took too long."
            : "The document check could not reach the server.",
          action: "Your selected files are still here. Try the check again.",
          retryable: true,
        },
      ]);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  };

  if (!shipment) {
    return (
      <>
        <Header title="Shipment not found" />
        <Main>
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Shipment not found</AlertTitle>
            <AlertDescription>
              This shipment does not exist.{" "}
              <Link href="/" className="font-medium underline">
                Back to shipments
              </Link>
            </AlertDescription>
          </Alert>
        </Main>
      </>
    );
  }

  return (
    <>
      <Header
        title={loading ? "Checking documents" : "Upload documents"}
        subtitle={`${shipment.name} · Step ${loading ? "3" : "2"} of 4`}
      />
      <Main className="mx-auto w-full max-w-4xl">
        <Button asChild variant="ghost" className="mb-4 -ml-2">
          <Link href="/">
            <ArrowLeft />
            Back to shipments
          </Link>
        </Button>

        <WorkflowSteps currentStep={loading ? 3 : 2} />

        {failures.length > 0 && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle />
            <AlertTitle>Check the selected documents</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 space-y-2">
                {failures.map((failure, index) => (
                  <li
                    key={`${failure.code}-${failure.document ?? "check"}-${index}`}
                  >
                    <span className="font-medium">{failure.message}</span>{" "}
                    <span>{failure.action}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {DOC_KEYS.map((key) => {
            const file = files[key];
            const fileFailure = failures.find(
              (failure) => failure.document === key,
            );
            return (
              <Card
                key={key}
                aria-disabled={loading}
                className={`relative transition-colors ${
                  loading ? "cursor-wait opacity-75" : "cursor-pointer"
                } ${
                  fileFailure
                    ? "border-red-300 bg-red-50/60 dark:bg-red-950/20"
                    : dragging[key]
                    ? "border-primary bg-primary/5"
                    : file
                      ? "border-green-300 bg-green-50/60 dark:bg-green-950/20"
                      : "hover:bg-muted/50"
                }`}
                onClick={() => {
                  if (!loading) inputRefs.current[key]?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (loading) return;
                  setDragging((prev) => ({ ...prev, [key]: true }));
                }}
                onDragLeave={() => {
                  if (!loading) {
                    setDragging((prev) => ({ ...prev, [key]: false }));
                  }
                }}
                onDrop={(event) => handleDrop(key, event)}
              >
                {file && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-2 top-2 z-10 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${DOC_NAMES[key]}`}
                    disabled={loading}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFile(key);
                    }}
                  >
                    <X />
                  </Button>
                )}
                <CardHeader>
                  <CardTitle className="text-sm">{DOC_NAMES[key]}</CardTitle>
                  <CardDescription className="text-xs">
                    {fileFailure
                      ? "Needs attention · click to replace"
                      : file
                      ? "Ready · click to replace"
                      : "Drag & drop or click to browse"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3 px-4 pb-6 pt-1 text-center">
                  {file ? (
                    <>
                      {fileFailure ? (
                        <AlertCircle className="size-8 text-red-600" />
                      ) : (
                        <CheckCircle2 className="size-8 text-green-600" />
                      )}
                      <div className="w-full min-w-0">
                        <p className="truncate text-sm font-medium">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(file.size)}
                        </p>
                        {fileFailure && (
                          <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                            {fileFailure.message}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="size-8 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Drop PDF here</p>
                        <p className="text-xs text-muted-foreground">
                          or click to browse
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
                <input
                  ref={(node) => {
                    inputRefs.current[key] = node;
                  }}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  disabled={loading}
                  onChange={(event) =>
                    acceptFile(key, event.target.files?.[0])
                  }
                />
              </Card>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
          {readyCount === 3 ? (
            <>
              {failures.some((failure) => failure.document) ? (
                <AlertCircle className="size-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="size-4 text-green-600" />
              )}
              <span
                className={
                  failures.some((failure) => failure.document)
                    ? "font-medium text-amber-700"
                    : "font-medium text-green-600"
                }
              >
                {failures.some((failure) => failure.document)
                  ? "3 PDFs selected · review the issue above"
                  : "All 3 PDFs ready"}
              </span>
            </>
          ) : (
            <span>
              {readyCount}/3 PDFs ready — add the remaining{" "}
              {DOC_KEYS.filter((key) => !files[key])
                .map((key) => DOC_NAMES[key])
                .join(", ")}
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={handleCompare}
            disabled={loading || readyCount !== 3}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Checking documents…
              </>
            ) : failures.some(
                (failure) =>
                  failure.stage === "extraction" ||
                  failure.stage === "comparison",
              ) ? (
              "Try check again"
            ) : (
              "Check documents"
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {failures.length > 0
              ? "Your selected files are kept here so you can replace one or try again."
              : "AI extraction takes a few seconds · nothing is saved on the server."}
          </p>
        </div>
      </Main>
    </>
  );
}
