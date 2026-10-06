import { DocumentsClient } from "./documents-client";

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { id } = await params;
  const { focus } = await searchParams;
  return <DocumentsClient shipmentId={id} focusDocumentId={focus} />;
}
