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
import {
  DOC_KEYS,
  DOC_NAMES,
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
  const [error, setError] = useState<string | null>(null);

  const readyCount = DOC_KEYS.filter((key) => files[key]).length;

  const acceptFile = useCallback((key: DocKey, file: File | undefined) => {
    setError(null);
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setError(`${DOC_NAMES[key]}: please choose a PDF file.`);
      return;
    }
    setFiles((prev) => ({ ...prev, [key]: file }));
  }, []);

  const removeFile = useCallback((key: DocKey) => {
    setFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleDrop = useCallback(
    (key: DocKey, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging((prev) => ({ ...prev, [key]: false }));
      acceptFile(key, event.dataTransfer.files[0]);
    },
    [acceptFile],
  );

  const handleCompare = async () => {
    const missing = DOC_KEYS.filter((key) => !files[key]);
    if (missing.length > 0) {
      setError(`Please add: ${missing.map((k) => DOC_NAMES[k]).join(", ")}.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      for (const key of DOC_KEYS) formData.append(key, files[key]!);

      const response = await fetch("/api/check", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "The consistency check failed.");
      }

      const result = data as CheckResult;
      saveResult(shipmentId, result);
      const errors = result.issues.filter(
        (issue) => issue.severity === "error",
      ).length;
      const warnings = result.issues.filter(
        (issue) => issue.severity === "warning",
      ).length;
      updateShipment(shipmentId, {
        status: "checked",
        mismatchCount: errors,
        reviewCount: warnings,
      });
      router.push(`/shipments/${shipmentId}/results`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The consistency check failed.",
      );
    } finally {
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
        title={shipment.name}
        subtitle="Upload documents · Step 2 of 4"
      />
      <Main className="mx-auto w-full max-w-4xl">
        <Button asChild variant="ghost" className="mb-4 -ml-2">
          <Link href="/">
            <ArrowLeft />
            All shipments
          </Link>
        </Button>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle />
            <AlertTitle>Something is off</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {DOC_KEYS.map((key) => {
            const file = files[key];
            return (
              <Card
                key={key}
                className={`relative cursor-pointer transition-colors ${
                  dragging[key]
                    ? "border-primary bg-primary/5"
                    : file
                      ? "border-green-300 bg-green-50/60 dark:bg-green-950/20"
                      : "hover:bg-muted/50"
                }`}
                onClick={() => inputRefs.current[key]?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging((prev) => ({ ...prev, [key]: true }));
                }}
                onDragLeave={() =>
                  setDragging((prev) => ({ ...prev, [key]: false }))
                }
                onDrop={(event) => handleDrop(key, event)}
              >
                {file && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-2 top-2 z-10 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${DOC_NAMES[key]}`}
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
                    {file
                      ? "Ready · click to replace"
                      : "Drag & drop or click to browse"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3 px-4 pb-6 pt-1 text-center">
                  {file ? (
                    <>
                      <CheckCircle2 className="size-8 text-green-600" />
                      <div className="w-full min-w-0">
                        <p className="truncate text-sm font-medium">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(file.size)}
                        </p>
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
              <CheckCircle2 className="size-4 text-green-600" />
              <span className="font-medium text-green-600">
                All 3 PDFs ready
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
                Extracting & comparing…
              </>
            ) : (
              "Check documents"
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            AI extraction takes a few seconds · nothing is saved on the server.
          </p>
        </div>
      </Main>
    </>
  );
}
