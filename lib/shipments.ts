import { deleteResult } from "./results";

export type ShipmentStatus = "draft" | "documents_ready" | "checked";

export type Shipment = {
  id: string;
  name: string;
  reference: string;
  createdAt: string;
  status: ShipmentStatus;
  errorCount?: number;
  warningCount?: number;
  mismatchCount?: number;
  reviewCount?: number;
};

const STORAGE_KEY = "tradelynk:shipments";

function readAll(): Shipment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Shipment[]) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

/** Subscribe to shipment changes made in this tab (for useSyncExternalStore). */
export function subscribeShipments(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function writeAll(shipments: Shipment[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shipments));
  shipmentCache.clear();
  listCache = undefined;
  for (const listener of listeners) listener();
}

export function listShipments(): Shipment[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

let listCache: { raw: string | null; value: Shipment[] } | undefined;

export function listShipmentsCached(): Shipment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (listCache && listCache.raw === raw) return listCache.value;
    const value = listShipments();
    listCache = { raw, value };
    return value;
  } catch {
    return listCache?.value ?? [];
  }
}

export function getShipment(id: string): Shipment | undefined {
  return readAll().find((shipment) => shipment.id === id);
}

const shipmentCache = new Map<
  string,
  { raw: string | null; value: Shipment | null }
>();

export function getShipmentCached(id: string): Shipment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const cached = shipmentCache.get(id);
    if (cached && cached.raw === raw) return cached.value;
    const value = readAll().find((shipment) => shipment.id === id) ?? null;
    shipmentCache.set(id, { raw, value });
    return value;
  } catch {
    return shipmentCache.get(id)?.value ?? null;
  }
}

export function createShipment(input: {
  name: string;
  reference: string;
}): Shipment {
  const shipment: Shipment = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    reference: input.reference.trim(),
    createdAt: new Date().toISOString(),
    status: "draft",
  };
  writeAll([shipment, ...readAll()]);
  return shipment;
}

export function updateShipment(
  id: string,
  patch: Partial<Shipment>,
): Shipment | undefined {
  const all = readAll();
  const index = all.findIndex((shipment) => shipment.id === id);
  if (index === -1) return undefined;
  all[index] = { ...all[index], ...patch };
  writeAll(all);
  return all[index];
}

/** Removes the shipment and any check result stored for it. */
export function deleteShipment(id: string): void {
  const all = readAll();
  const next = all.filter((shipment) => shipment.id !== id);
  if (next.length === all.length) return;
  deleteResult(id);
  writeAll(next);
}
