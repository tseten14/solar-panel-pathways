/**
 * Shared page chrome.
 *
 * Each page used to hand-roll its own title block, so they drifted: different
 * heading sizes, different gaps, badges above the subtitle on one page and
 * beside it on another — and the two map pages had no title at all, so you
 * could land on /map with nothing on screen naming where you were.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Badges, filters or buttons, right-aligned on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** Title block for a normal scrolling page. */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Title bar for a full-height map page, where the content below must fill the
 * remaining space exactly. Shorter and denser than PageHeader, because here the
 * map is the content and the header is only orientation.
 */
export function MapPageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border/50 bg-card/30 px-6 py-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Padding, rhythm and a max width for scrolling pages. The cap keeps stat rows
 * and tables readable on an ultrawide monitor instead of stretching edge to edge.
 */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1600px] space-y-6 p-6", className)}>{children}</div>
  );
}

/** Full-height shell for a map page: fixed header, content fills the rest. */
export function MapPageShell({ children }: { children: ReactNode }) {
  return <div className="flex h-[calc(100vh-3rem)] flex-col overflow-hidden">{children}</div>;
}
