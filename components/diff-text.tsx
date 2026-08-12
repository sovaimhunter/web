import { useMemo } from "react";
import { diffChars } from "@/lib/diff";

export function DiffText({
  value,
  reference,
}: {
  value: string;
  reference: string;
}) {
  const segments = useMemo(
    () => diffChars(value, reference),
    [value, reference],
  );
  const hasChanges = segments.some((segment) => segment.changed);

  if (!hasChanges) return <>{value}</>;

  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <span
            key={index}
            className="font-semibold text-red-600 dark:text-red-400"
          >
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
