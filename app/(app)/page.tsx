"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, FileCheck, PackagePlus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { listShipmentsCached, type Shipment } from "@/lib/shipments";

const emptySubscribe = () => () => {};
const EMPTY_SHIPMENTS: Shipment[] = [];

function StatusBadge({ shipment }: { shipment: Shipment }) {
  if (shipment.status === "checked") {
    const mismatches = shipment.mismatchCount ?? shipment.errorCount ?? 0;
    const reviews = shipment.reviewCount ?? shipment.warningCount ?? 0;
    const hasMismatches = mismatches > 0;
    const hasReviews = reviews > 0 && !hasMismatches;
    return (
      <Badge
        variant={hasMismatches ? "destructive" : "secondary"}
        className={
          hasReviews
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : hasMismatches
              ? ""
              : "bg-muted text-muted-foreground"
        }
      >
        {hasMismatches
          ? `${mismatches} mismatch${mismatches === 1 ? "" : "es"}`
          : hasReviews
            ? `${reviews} require${reviews === 1 ? "s" : ""} review`
            : "All matched"}
      </Badge>
    );
  }
  if (shipment.status === "documents_ready") {
    return <Badge variant="outline">Documents ready</Badge>;
  }
  return <Badge variant="secondary">Draft</Badge>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ShipmentsPage() {
  const [filter, setFilter] = useState("");
  const shipments = useSyncExternalStore(
    emptySubscribe,
    listShipmentsCached,
    () => EMPTY_SHIPMENTS,
  );

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return shipments;
    return shipments.filter(
      (shipment) =>
        shipment.name.toLowerCase().includes(query) ||
        shipment.reference.toLowerCase().includes(query),
    );
  }, [shipments, filter]);

  return (
    <>
      <Header title="Shipments" subtitle="Your export shipments and check status" />
      <Main className="flex flex-1 flex-col gap-4 sm:gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Shipments</h2>
            <p className="text-muted-foreground">
              Here&apos;s a list of your shipments.
            </p>
          </div>
          <Button asChild>
            <Link href="/shipments/new">
              <PackagePlus />
              New shipment
            </Link>
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name or reference…"
            className="pl-9"
          />
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No shipments yet</CardTitle>
              <CardDescription>
                {shipments.length === 0
                  ? "Create your first shipment to upload documents and run a consistency check."
                  : "No shipments match your filter."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/shipments/new">
                  <PackagePlus />
                  Create shipment
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border bg-card">
            <div className="overflow-x-auto">
              <Table className="min-w-xl">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Shipment</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((shipment) => (
                    <TableRow key={shipment.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/shipments/${shipment.id}/documents`}
                          className="hover:underline"
                        >
                          {shipment.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {shipment.reference || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(shipment.createdAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge shipment={shipment} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {shipment.status === "checked" && (
                            <Button
                              asChild
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`View results for ${shipment.name}`}
                            >
                              <Link href={`/shipments/${shipment.id}/results`}>
                                <FileCheck />
                              </Link>
                            </Button>
                          )}
                          <Button
                            asChild
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Open ${shipment.name}`}
                          >
                            <Link
                              href={`/shipments/${shipment.id}/documents`}
                            >
                              <ArrowUpRight />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Main>
    </>
  );
}
