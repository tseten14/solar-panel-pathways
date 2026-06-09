import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { AlertTriangle, MapPin, DollarSign, TrendingUp, Info } from "lucide-react";
import { DataFreshnessBadge } from "@/components/DataFreshnessBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLandfills } from "@/hooks/useLandfills";
import { useSolarStatsByState } from "@/hooks/useSolarData";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import { computeStateCoverage } from "@/lib/state-coverage";

export default function MLPredictions() {
  const { data: landfills = [], isLoading: landfillsLoading, isError: landfillsError, refetch } = useLandfills();
  const { data: solarStats = [], isLoading: solarLoading, isError: solarError } = useSolarStatsByState();

  const coverage = useMemo(
    () => computeStateCoverage(landfills, solarStats),
    [landfills, solarStats],
  );

  const [selectedState, setSelectedState] = useState("CA");
  const effectiveState = coverage.some((c) => c.state === selectedState)
    ? selectedState
    : coverage[0]?.state ?? "CA";
  const prediction = coverage.find((p) => p.state === effectiveState);

  const costData = coverage.map((p) => ({
    state: p.state,
    cost: p.avgCost,
    acceptance: p.acceptanceProbability,
  }));
  const wasteDeserts = coverage.filter((p) => p.wasteDesert);

  const confidenceData = prediction
    ? Array.from({ length: 20 }, (_, i) => {
        const x = prediction.confidence[0] + (i * (prediction.confidence[1] - prediction.confidence[0])) / 19;
        const mid = (prediction.confidence[0] + prediction.confidence[1]) / 2;
        const sigma = (prediction.confidence[1] - prediction.confidence[0]) / 4;
        const y = Math.exp(-0.5 * Math.pow((x - mid) / sigma, 2));
        return { x: Math.round(x), y: Math.round(y * 100) };
      })
    : [];

  const isLoading = landfillsLoading || solarLoading;
  const isError = landfillsError || solarError;

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
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">State Coverage Analysis</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Methodology">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                Heuristic estimates from EPA LMOP landfill locations, USGS USPVDB solar capacity, and
                local PV survey enrichment — not a trained machine-learning model.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Policy and disposal estimates · EPA LMOP + USGS USPVDB</p>
          <DataFreshnessBadge />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Analyze state:</span>
          <Select value={effectiveState} onValueChange={setSelectedState}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {coverage.map((p) => <SelectItem key={p.state} value={p.state}>{p.state}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* State prediction detail */}
      {prediction && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="stat-label">Acceptance Prob.</span>
            </div>
            <p className="stat-value" style={{ color: prediction.acceptanceProbability > 50 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)" }}>
              {prediction.acceptanceProbability}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">CI: {prediction.confidence[0]}–{prediction.confidence[1]}%</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="stat-label">Avg Disposal Cost</span>
            </div>
            <p className="stat-value text-foreground">${prediction.avgCost}<span className="text-lg text-muted-foreground">/ton</span></p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="stat-label">Nearest Facility</span>
            </div>
            <p className="text-sm font-medium text-foreground">{prediction.nearestFacility}</p>
            <p className="text-xs text-muted-foreground">{prediction.nearestDistance} miles away</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <span className="stat-label">Waste Desert</span>
            </div>
            {prediction.wasteDesert ? (
              <Badge variant="destructive" className="mt-1">⚠ Waste Desert</Badge>
            ) : (
              <Badge variant="default" className="mt-1">Adequate Coverage</Badge>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Cost by Region ($/ton)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 20%)" />
              <XAxis dataKey="state" stroke="hsl(215 20% 55%)" fontSize={12} />
              <YAxis stroke="hsl(215 20% 55%)" fontSize={12} />
              <RTooltip contentStyle={{ background: "hsl(217 33% 12%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 8, color: "hsl(210 40% 92%)" }} />
              <Bar dataKey="cost" fill="hsl(43 96% 56%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Confidence Distribution — {effectiveState}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={confidenceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 20%)" />
              <XAxis dataKey="x" stroke="hsl(215 20% 55%)" fontSize={12} label={{ value: "Acceptance %", position: "insideBottom", offset: -5, style: { fill: "hsl(215 20% 55%)" } }} />
              <YAxis stroke="hsl(215 20% 55%)" fontSize={12} />
              <RTooltip contentStyle={{ background: "hsl(217 33% 12%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 8, color: "hsl(210 40% 92%)" }} />
              <Area type="monotone" dataKey="y" stroke="hsl(43 96% 56%)" fill="hsl(43 96% 56%)" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Waste Deserts */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-reject" />
          Waste Desert States
        </h3>
        <div className="flex flex-wrap gap-2">
          {wasteDeserts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No waste desert states detected in current data.</p>
          ) : (
            wasteDeserts.map((p) => (
              <div key={p.state} className="px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/10">
                <p className="text-sm font-medium text-foreground">{p.state}</p>
                <p className="text-xs text-muted-foreground">{p.acceptanceProbability}% — {p.nearestDistance}mi to nearest</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
