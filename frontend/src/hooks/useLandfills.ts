import { useQuery } from "@tanstack/react-query";
import { fetchLandfills } from "@/lib/landfill-api";

export function useLandfills() {
  return useQuery({
    queryKey: ["landfills", "lmop"],
    queryFn: fetchLandfills,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}
