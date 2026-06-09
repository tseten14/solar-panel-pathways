import { useDataFreshness } from "@/hooks/useDataFreshness";
import { Badge } from "@/components/ui/badge";

export function DataFreshnessBadge() {
  const { summary, isLoading } = useDataFreshness();

  if (isLoading || !summary) return null;

  return (
    <Badge variant="outline" className="text-xs font-normal" title={summary}>
      {summary}
    </Badge>
  );
}
