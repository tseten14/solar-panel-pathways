import { Building2, MapPin, Sun, ArrowRightLeft } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { MiniMap } from "@/components/MiniMap";
import { tradeRoutes } from "@/data/mockData";
import { useNavigate } from "react-router-dom";
import { useLandfills } from "@/hooks/useLandfills";
import { useSolarStatsByState } from "@/hooks/useSolarData";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import { Badge } from "@/components/ui/badge";

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
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">PV Waste Flow Intelligence Overview</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">EPA LMOP</Badge>
          <Badge variant="outline" className="text-xs">USGS USPVDB</Badge>
        </div>
      </div>

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
          label="Trade Routes Mapped"
          value={tradeRoutes.length}
          subtitle={`${tradeRoutes.filter((r) => r.isInternational).length} international (demo)`}
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

      <div className="glass-card overflow-hidden" style={{ height: 400 }}>
        <MiniMap landfills={landfills} />
      </div>
    </div>
  );
}
