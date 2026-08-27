"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function Header({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="app-header sticky top-0 z-50 flex h-16 items-center gap-3 border-b px-4 backdrop-blur-xl sm:px-6">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </header>
  );
}
