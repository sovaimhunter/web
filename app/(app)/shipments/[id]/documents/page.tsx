import { DocumentsClient } from "./documents-client";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentsClient shipmentId={id} />;
}
