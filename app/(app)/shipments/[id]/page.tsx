import { redirect } from "next/navigation";

export default async function ShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/shipments/${encodeURIComponent(id)}/documents`);
}
