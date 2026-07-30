import { useQuery } from "@tanstack/react-query";
import { fetchLandfills } from "@/lib/landfill-api";
import { enrichLandfillsWithSurvey, loadSurveyData } from "@/lib/survey-data";

export function useLandfills() {
  return useQuery({
    queryKey: ["landfills", "lmop"],
    queryFn: async () => {
      // Survey data is optional enrichment — a failure to load it must not fail
      // the whole query and blank the dashboard. enrichLandfillsWithSurvey()
      // already no-ops on empty input.
      const [landfills, survey] = await Promise.all([
        fetchLandfills(),
        loadSurveyData().catch(() => undefined),
      ]);
      return enrichLandfillsWithSurvey(landfills, survey);
    },
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}
