"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackagePlus, Pencil, Search, Trash2 } from "lucide-react";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  deleteShipment,
  listShipmentsCached,
  subscribeShipments,
  updateShipment,
  type Shipment,
} from "@/lib/shipments";

const EMPTY_SHIPMENTS: Shipment[] = [];

/** Checked shipments open on their results; anything else opens on documents. */
function shipmentHref(shipment: Shipment): string {
  return shipment.status === "checked" || shipment.status === "check_failed"
    ? `/shipments/${shipment.id}/results`
    : `/shipments/${shipment.id}/documents`;
}

function StatusBadge({ shipment }: { shipment: Shipment }) {
  if (shipment.status === "checked") {
    const mustFix = shipment.mustFixCount ?? 0;
    const reviews = shipment.reviewCount ?? 0;
    const hasMustFix = mustFix > 0;
    const hasReviews = reviews > 0 && !hasMustFix;
    return (
      <Badge
        variant={hasMustFix ? "destructive" : "secondary"}
        className={
          hasReviews
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : hasMustFix
              ? ""
              : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
        }
      >
        {hasMustFix
          ? `${mustFix} Must Fix`
          : hasReviews
            ? `${reviews} Review`
            : "Passed"}
      </Badge>
    );
  }
  if (shipment.status === "check_failed") {
    return <Badge variant="destructive">Check incomplete</Badge>;
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
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Shipment | null>(null);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [editName, setEditName] = useState("");
  const [editReference, setEditReference] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const openEditor = (shipment: Shipment) => {
    setEditName(shipment.name);
    setEditReference(shipment.reference);
    setEditError(null);
    setEditing(shipment);
  };

  const saveEditor = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!editName.trim()) {
      setEditError("Please give the shipment a name.");
      return;
    }
    updateShipment(editing.id, {
      name: editName.trim(),
      reference: editReference.trim(),
    });
    setEditing(null);
  };
  const shipments = useSyncExternalStore(
    subscribeShipments,
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
          {shipments.length > 0 && (
            <Button asChild>
              <Link href="/shipments/new">
                <PackagePlus />
                New shipment
              </Link>
            </Button>
          )}
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
              <CardTitle>
                {shipments.length === 0
                  ? "No shipments yet"
                  : "No matching shipments"}
              </CardTitle>
              <CardDescription>
                {shipments.length === 0
                  ? "Create your first shipment to upload documents and run a consistency check."
                  : "No shipments match your filter."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {shipments.length === 0 ? (
                <Button asChild>
                  <Link href="/shipments/new">
                    <PackagePlus />
                    New shipment
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setFilter("")}>
                  Clear filter
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="brand-surface overflow-hidden rounded-xl border bg-card">
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
                    <TableRow
                      key={shipment.id}
                      className="cursor-pointer"
                      onClick={() => router.push(shipmentHref(shipment))}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={shipmentHref(shipment)}
                          className="hover:underline"
                          onClick={(event) => event.stopPropagation()}
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
                        <div
                          className="flex justify-end gap-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${shipment.name}`}
                            title="Edit shipment"
                            onClick={() => openEditor(shipment)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${shipment.name}`}
                            title="Delete shipment"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setPendingDelete(shipment)}
                          >
                            <Trash2 />
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

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <form onSubmit={saveEditor} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Edit shipment</DialogTitle>
              <DialogDescription>
                Rename this shipment or change its reference.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Shipment name *</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(event) => {
                  setEditName(event.target.value);
                  setEditError(null);
                }}
                placeholder="e.g. Art shipment to Berlin — Aug 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-reference">Reference (optional)</Label>
              <Input
                id="edit-reference"
                value={editReference}
                onChange={(event) => setEditReference(event.target.value)}
                placeholder="e.g. OO-INV-2026-0142"
              />
            </div>
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete shipment?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `“${pendingDelete.name}” and its check results will be permanently removed. This can’t be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteShipment(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              <Trash2 />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
