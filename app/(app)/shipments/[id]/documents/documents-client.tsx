"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, FileText, LoaderCircle, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { WorkflowSteps } from "@/components/workflow-steps";
import {
  deleteDocument,
  runShipmentCheck,
  shipmentApi,
  uploadDocument,
} from "@/lib/persistence/api-client";
import {
  DOCUMENT_TYPE_LABELS,
  SHIPMENT_STATUS_LABELS,
  type DocumentRecord,
  type ShipmentDetail,
} from "@/lib/persistence/types";
import { cn } from "@/lib/utils";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsClient({
  shipmentId,
  focusDocumentId,
}: {
  shipmentId: string;
  focusDocumentId?: string;
}) {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<DocumentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const detail = await shipmentApi.get(shipmentId);
    setShipment(detail);
  };

  useEffect(() => {
    let cancelled = false;
    void shipmentApi
      .get(shipmentId)
      .then((detail) => {
        if (!cancelled) setShipment(detail);
      })
      .catch((value: unknown) => {
        if (!cancelled) {
          setError(value instanceof Error ? value.message : "Could not load shipment");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  useEffect(() => {
    if (!focusDocumentId || loading) return;
    document.getElementById(`document-${focusDocumentId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [focusDocumentId, loading]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) await uploadDocument({ shipmentId, file });
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not upload document");
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const replaceFile = async (file: File | undefined) => {
    if (!file || !replaceTarget) return;
    setBusy(true);
    setError(null);
    try {
      await uploadDocument({
        shipmentId,
        file,
        documentType: replaceTarget.documentType,
        replaceDocumentId: replaceTarget.id,
      });
      setReplaceTarget(null);
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not replace document");
    } finally {
      setBusy(false);
      if (replaceRef.current) replaceRef.current.value = "";
    }
  };

  const remove = async (document: DocumentRecord) => {
    if (!window.confirm(`Delete ${document.originalName}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDocument(shipmentId, document.id);
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not delete document");
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!shipment || shipment.documents.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await runShipmentCheck(shipmentId);
      router.push(`/shipments/${shipmentId}/results`);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not run the check");
      setBusy(false);
    }
  };

  if (loading) {
    return <><Header title="Documents" subtitle="Loading shipment…" /><Main>Loading…</Main></>;
  }
  if (!shipment) {
    return <><Header title="Shipment not found" /><Main><Alert variant="destructive"><AlertCircle /><AlertTitle>Shipment not found</AlertTitle></Alert></Main></>;
  }

  const documents = shipment.documents;
  return (
    <>
      <Header title="Documents" subtitle={`${shipment.name} · ${SHIPMENT_STATUS_LABELS[shipment.status]}`} />
      <Main className="mx-auto w-full max-w-4xl">
        <Button asChild variant="ghost" className="mb-4 -ml-2"><Link href="/"><ArrowLeft />Back to shipments</Link></Button>
        <WorkflowSteps currentStep={2} />
        {focusDocumentId && shipment.documents.some((document) => document.id === focusDocumentId) && (
          <Alert className="mb-5 border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
            <AlertCircle />
            <AlertTitle>This file needs attention</AlertTitle>
            <AlertDescription>Replace it if the source is incorrect, then run the check again.</AlertDescription>
          </Alert>
        )}
        {error && <Alert variant="destructive" className="mb-5"><AlertCircle /><AlertTitle>Something needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Shipment files</CardTitle><p className="mt-1 text-sm text-muted-foreground">Upload any export document. Replacements create a new version.</p></div>
            <Button onClick={() => uploadRef.current?.click()} disabled={busy}><UploadCloud />Upload PDFs</Button>
          </CardHeader>
          <CardContent>
            <input ref={uploadRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(event) => addFiles([...(event.target.files ?? [])])} />
            <input ref={replaceRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => replaceFile(event.target.files?.[0])} />
            {documents.length === 0 ? (
              <button type="button" onClick={() => uploadRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-muted-foreground hover:bg-muted/40"><UploadCloud className="size-8" /><span className="text-sm font-medium">Add your first PDF</span></button>
            ) : (
              <div className="space-y-3">
                {documents.map((document) => (
                  <div
                    key={document.id}
                    id={`document-${document.id}`}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4",
                      focusDocumentId === document.id && "border-amber-400 bg-amber-50/50 ring-2 ring-amber-200 dark:bg-amber-950/15 dark:ring-amber-900/50",
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3"><FileText className="mt-0.5 size-5 text-muted-foreground" /><div className="min-w-0"><p className="truncate font-medium">{document.originalName}</p><p className="text-xs text-muted-foreground">{DOCUMENT_TYPE_LABELS[document.documentType]} · v{document.version} · {formatSize(document.sizeBytes)}</p></div></div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{document.status}</Badge>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => { setReplaceTarget(document); replaceRef.current?.click(); }}><RefreshCw />Replace</Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${document.originalName}`} disabled={busy} onClick={() => remove(document)}><Trash2 /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
          <p className="text-sm text-muted-foreground">{documents.length} active document{documents.length === 1 ? "" : "s"}</p>
          <Button
            size="lg"
            disabled={busy || documents.length === 0}
            onClick={runCheck}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {busy ? "Checking documents…" : "Run check"}
          </Button>
        </div>
        {documents.length > 0 && <p className="mt-2 text-right text-xs text-muted-foreground">PDFs are sent to OpenAI for field extraction when you run a check.</p>}
      </Main>
    </>
  );
}
