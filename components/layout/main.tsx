import type { ReactNode } from "react";

export function Main({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`flex-1 px-4 py-6 sm:px-6 ${className ?? ""}`}>
      {children}
    </main>
  );
}
