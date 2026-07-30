import { useQuery } from "@tanstack/react-query";
import {
  fetchSolarCohorts,
  fetchSolarFacilitiesByState,
  fetchSolarStatsByState,
  fetchSolarTechMix,
} from "@/lib/solar-api";

/** Installed capacity by state and commissioning year (USPVDB p_year). */
export function useSolarCohorts() {
  return useQuery({
    queryKey: ["solar", "cohorts"],
    queryFn: fetchSolarCohorts,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

/** Installed capacity by module chemistry (USPVDB p_tech_sec). */
export function useSolarTechMix() {
  return useQuery({
    queryKey: ["solar", "tech-mix"],
    queryFn: fetchSolarTechMix,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

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
