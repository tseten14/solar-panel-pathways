import { useQuery } from "@tanstack/react-query";
import { fetchBackendHealth, formatFetchedAt } from "@/lib/apiHealth";

export function useDataFreshness() {
  const query = useQuery({
    queryKey: ["backend-health"],
    queryFn: fetchBackendHealth,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const landfillsLabel = formatFetchedAt(query.data?.landfills_fetched_at);
  const solarLabel = formatFetchedAt(query.data?.solar_fetched_at);

  return {
    health: query.data,
    isLoading: query.isLoading,
    landfillsLabel,
    solarLabel,
    summary:
      landfillsLabel && solarLabel
        ? `EPA LMOP ${landfillsLabel} · USGS USPVDB ${solarLabel}`
        : landfillsLabel
          ? `EPA LMOP data as of ${landfillsLabel}`
          : null,
  };
}
