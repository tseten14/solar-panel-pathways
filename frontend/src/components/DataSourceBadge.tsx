import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DATA_SOURCES = ["EPA LMOP", "USGS USPVDB"] as const;

export function DataSourceBadge({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-2 flex-wrap", className)}>
      {DATA_SOURCES.map((source) => (
        <Badge key={source} variant="outline" className="text-xs">
          {source}
        </Badge>
      ))}
    </div>
  );
}
