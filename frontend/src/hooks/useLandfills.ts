import { useQuery } from "@tanstack/react-query";
import { fetchLandfills } from "@/lib/landfill-api";
import { enrichLandfillsWithSurvey, loadSurveyData } from "@/lib/survey-data";

export function useLandfills() {
  return useQuery({
    queryKey: ["landfills", "lmop"],
    queryFn: async () => {
      const [landfills, survey] = await Promise.all([fetchLandfills(), loadSurveyData()]);
      return enrichLandfillsWithSurvey(landfills, survey);
    },
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}
