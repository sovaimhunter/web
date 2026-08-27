import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="app-shell flex min-h-svh flex-1 flex-col bg-transparent">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
