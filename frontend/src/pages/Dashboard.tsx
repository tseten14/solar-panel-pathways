/**
 * The landing page: headline numbers for the whole country.
 *
 * Shows how many landfills exist and how many are still open (EPA), how much
 * solar is installed (USGS), and a national map. Also hosts the "Solar AI"
 * button, which answers questions using only these figures.
 */
import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Sun, ArrowRightLeft } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { MiniMap } from "@/components/MiniMap";
import { useNavigate } from "react-router-dom";
import { useLandfills } from "@/hooks/useLandfills";
import { useSolarStatsByState } from "@/hooks/useSolarData";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import { Badge } from "@/components/ui/badge";
import { DataFreshnessBadge } from "@/components/DataFreshnessBadge";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { computeModelledTradeRoutes } from "@/lib/trade-flows";
import SolarAiPanel from "@/components/dashboard/SolarAiPanel";
import { buildSolarAiContext } from "@/lib/solar-ai-context";
import { fetchDetectionStats, type DetectionStats } from "@/lib/solar-scan-api";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: landfills = [], isLoading: landfillsLoading, isError: landfillsError, refetch: refetchLandfills } = useLandfills();
  const { data: solarStats = [], isLoading: solarLoading, isError: solarError } = useSolarStatsByState();

  const isLoading = landfillsLoading || solarLoading;
  const isError = landfillsError || solarError;

  const stateCount = new Set(landfills.map((l) => l.state).filter((s) => s !== "—")).size;
  const openCount = landfills.filter((l) => l.operationalStatus === "Open").length;
  const totalSolarMw = Math.round(solarStats.reduce((s, r) => s + r.totalCapacityMw, 0));
  const totalSolarFacilities = solarStats.reduce((s, r) => s + r.facilityCount, 0);
  const modelledRoutes = useMemo(
    () => computeModelledTradeRoutes(landfills, solarStats),
    [landfills, solarStats],
  );

  const [detectionStats, setDetectionStats] = useState<DetectionStats | null>(null);
  useEffect(() => {
    fetchDetectionStats().then(setDetectionStats).catch(() => setDetectionStats(null));
  }, []);

  const solarAiContext = useMemo(
    () => buildSolarAiContext(landfills, solarStats, modelledRoutes, detectionStats),
    [landfills, solarStats, modelledRoutes, detectionStats],
  );

  const filters = [
    { label: "Landfill Map", onClick: () => navigate("/map") },
    { label: "Facility Data", onClick: () => navigate("/data") },
    { label: "Active Trade Routes", onClick: () => navigate("/trade-flows") },
  ];

  if (isLoading) {
    return (
      <div className="p-6">
        <DataLoadingState message="Loading EPA landfill and USGS solar data…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <DataErrorState
          message="Could not load live data from EPA LMOP or USGS USPVDB. Check your network connection and try again."
          onRetry={() => refetchLandfills()}
        />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        subtitle="PV waste flow intelligence overview"
        actions={
          <>
            <Badge variant="outline" className="text-xs">EPA LMOP</Badge>
            <Badge variant="outline" className="text-xs">USGS USPVDB</Badge>
            <DataFreshnessBadge />
            <SolarAiPanel factLedger={solarAiContext.fact_ledger} />
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="MSW Landfills"
          value={landfills.length.toLocaleString()}
          subtitle={`${stateCount} states · EPA LMOP`}
        />
        <StatCard
          icon={MapPin}
          label="Open Landfills"
          value={openCount.toLocaleString()}
          subtitle={`${Math.round((openCount / landfills.length) * 100)}% operational`}
          highlight
        />
        <StatCard
          icon={Sun}
          label="Utility Solar Capacity"
          value={`${totalSolarMw.toLocaleString()} MW`}
          subtitle={`${totalSolarFacilities.toLocaleString()} facilities · USPVDB`}
        />
        <StatCard
          icon={ArrowRightLeft}
          label="Modelled Flows"
          value={modelledRoutes.length}
          subtitle="Interstate routes · estimated"
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.label}
            onClick={f.onClick}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Taller on big screens, where a fixed 400px left the map stranded in
          whitespace. */}
      <div className="glass-card h-[400px] overflow-hidden xl:h-[520px]">
        <MiniMap landfills={landfills} />
      </div>
    </PageContainer>
  );
}
