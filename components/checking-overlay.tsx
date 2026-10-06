"use client";

import { useEffect, useState } from "react";
import { FileSearch, LoaderCircle } from "lucide-react";

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export function CheckingOverlay({
  open,
  documentCount,
}: {
  open: boolean;
  documentCount: number;
}) {
  if (!open) return null;
  return <ActiveCheckingOverlay documentCount={documentCount} />;
}

function ActiveCheckingOverlay({ documentCount }: { documentCount: number }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Checking shipment documents"
    >
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FileSearch className="size-7" />
        </div>
        <div className="mt-5 flex items-center justify-center gap-2">
          <LoaderCircle className="size-5 animate-spin text-primary" />
          <h2 className="text-lg font-semibold">Checking documents</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Extracting fields and comparing {documentCount} PDF{documentCount === 1 ? "" : "s"}.
          Larger or scanned files can take a little longer.
        </p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[checking_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>Keep this page open</span>
          <span className="tabular-nums">Elapsed {formatElapsed(elapsedSeconds)}</span>
        </div>
      </div>
      <style jsx>{`
        @keyframes checking {
          0% { transform: translateX(-110%); }
          50% { transform: translateX(100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
