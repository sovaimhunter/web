import type { ReactNode } from "react";

export function Main({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`app-main flex-1 px-4 py-7 sm:px-7 lg:px-8 ${className ?? ""}`}>
      {children}
    </main>
  );
}
