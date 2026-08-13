"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { createShipment } from "@/lib/shipments";

export default function NewShipmentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Please give the shipment a name.");
      return;
    }
    const shipment = createShipment({ name, reference });
    router.push(`/shipments/${shipment.id}/documents`);
  };

  return (
    <>
      <Header title="New shipment" subtitle="Create a shipment to get started" />
      <Main className="mx-auto w-full max-w-xl">
        <Button asChild variant="ghost" className="mb-4 -ml-2">
          <Link href="/">
            <ArrowLeft />
            Back to shipments
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Create shipment</CardTitle>
            <CardDescription>
              Give this shipment a name, then upload its three export documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Shipment name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Art shipment to Berlin — Aug 2026"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reference">Reference (optional)</Label>
                <Input
                  id="reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="e.g. OO-INV-2026-0142"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full">
                <PackagePlus />
                Create & upload documents
              </Button>
            </form>
          </CardContent>
        </Card>
      </Main>
    </>
  );
}
