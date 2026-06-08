import { useQuery } from "@tanstack/react-query";
import { fetchSolarFacilitiesByState, fetchSolarStatsByState } from "@/lib/solar-api";

export function useSolarStatsByState() {
  return useQuery({
    queryKey: ["solar", "stats-by-state"],
    queryFn: fetchSolarStatsByState,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

export function useSolarFacilitiesByState(state: string | null) {
  return useQuery({
    queryKey: ["solar", "facilities", state],
    queryFn: () => fetchSolarFacilitiesByState(state!),
    enabled: Boolean(state && state !== "all"),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}
