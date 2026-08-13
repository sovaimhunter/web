import { ResultsClient } from "./results-client";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultsClient shipmentId={id} />;
}
