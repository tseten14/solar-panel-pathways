import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-svh w-full overflow-hidden">
        <AppSidebar />
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 bg-card/30 px-3 backdrop-blur-sm">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto">
            {children}
          </main>
          <footer className="shrink-0 border-t border-border/60 bg-card/40 px-6 py-3">
            <p className="text-xs text-muted-foreground">NREL Research Tool</p>
            <p className="text-xs text-muted-foreground">v1.1.0 — Live Data</p>
            <p className="mt-1 text-xs text-muted-foreground">EPA LMOP · USGS USPVDB</p>
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
