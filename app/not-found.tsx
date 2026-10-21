"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Ship className="size-6" />
        </span>
        <div className="mt-4 flex items-center justify-center gap-2">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          <h1 className="font-semibold">Returning to shipments…</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This saved browser address is no longer available.
        </p>
        <Button asChild className="mt-5">
          <Link href="/">Open shipments</Link>
        </Button>
      </div>
    </main>
  );
}
